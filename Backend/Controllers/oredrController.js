import crypto from 'crypto'
import mongoose from 'mongoose'
import Razorpay from 'razorpay'
import Order from '../Modals/orderModal.js'
import Item from '../Modals/itemModal.js'
import { CartItem } from '../Modals/cartModal.js'
import 'dotenv/config'
import validator from 'validator'

/** User ko 5s window: iske baad order admin panel mein dikhta hai */
const ADMIN_GRACE_MS = Number(process.env.ORDER_ADMIN_GRACE_MS || 5000);

/** Admin ke "out for delivery" ke kitne der baad status auto `delivered` ho (ms) */
const AUTO_DELIVER_AFTER_OUT_MS = Number(
    process.env.ORDER_AUTO_DELIVER_AFTER_OUT_MS || 5 * 60 * 1000,
);

function scheduleAdminVisibleAt() {
    return new Date(Date.now() + ADMIN_GRACE_MS);
}

/** Admin list: paid/COD orders jinka grace period khatam ho chuka ho */
function adminVisibleOrderFilter() {
    const now = new Date();
    return {
        status: { $ne: 'cancelled' },
        $and: [
            {
                $or: [
                    { paymentStatus: 'succeeded' },
                    { paymentMethod: 'cod' },
                ],
            },
            {
                $or: [
                    { adminVisibleAt: { $lte: now } },
                    { adminVisibleAt: null },
                    { adminVisibleAt: { $exists: false } },
                ],
            },
        ],
    };
}

function getRazorpay() {
    const keyId = process.env.RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    if (!keyId || !keySecret) return null
    return new Razorpay({ key_id: keyId, key_secret: keySecret })
}

const getOrderRetentionHours = () => {
    const raw = Number(process.env.ORDER_RETENTION_HOURS || 0);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

// Auto cleanup rule: delete old delivered orders after configured hours.
export const cleanupOldOrdersRetention = async () => {
    const retentionHours = getOrderRetentionHours();
    if (!retentionHours) {
        return { enabled: false, deletedCount: 0, retentionHours: 0 };
    }

    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);
    const result = await Order.deleteMany({
        status: 'delivered',
        createdAt: { $lt: cutoff },
    });

    return {
        enabled: true,
        deletedCount: result.deletedCount || 0,
        retentionHours,
        cutoff: cutoff.toISOString(),
    };
}

// CREATE ORDER FUNCTION
export const createOrder = async (req, res) => {
    try {
        const {
            firstName, lastName, phone, email, address, city, zipCode,
            paymentMethod, subtotal, tax, total, items,
        } = req.body;

        if (!/^\d{10}$/.test(String(phone || ''))) {
            return res.status(400).json({ message: 'Phone number must be exactly 10 digits' })
        }
        if (!validator.isEmail(String(email || ''))) {
            return res.status(400).json({ message: 'Please enter a valid email address' })
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "Invalid or empty items array" })
        }

        const orderItems = items.map((row) => {
            const { item, name, price, imageUrl, quantity, productId } = row;
            const base = item || {};
            const rawId = base._id ?? base.id ?? productId;
            let menuItemId;
            if (rawId != null && mongoose.Types.ObjectId.isValid(String(rawId))) {
                menuItemId = new mongoose.Types.ObjectId(String(rawId));
            }
            const line = {
                item: {
                    name: base.name || name || 'Unknown',
                    price: Number(base.price ?? price) || 0,
                    imageUrl: base.imageUrl || imageUrl || '',
                },
                quantity: Number(quantity) || 0,
            };
            if (menuItemId) line.menuItemId = menuItemId;
            return line;
        });

        const shippingCost = 0;
        let newOrder;


        if (paymentMethod === 'online') {
            const rzp = getRazorpay();
            if (!rzp) {
                return res.status(500).json({
                    message: 'Razorpay keys missing. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to Backend .env (Dashboard → Test mode).',
                });
            }

            const amountPaise = Math.round(Number(total) * 100);
            if (!Number.isFinite(amountPaise) || amountPaise < 100) {
                return res.status(400).json({ message: 'Invalid order total (min ₹1)' });
            }

            newOrder = new Order({
                user: req.user._id,
                firstName, lastName, phone, email, address, city, zipCode, paymentMethod, subtotal,
                tax, total, shipping: shippingCost, items: orderItems,
                paymentStatus: 'pending',
                adminVisibleAt: null,
            });

            await newOrder.save();

            try {
                const receipt = `ff_${String(newOrder._id).slice(-12)}`.slice(0, 40);
                const razorpayOrder = await rzp.orders.create({
                    amount: amountPaise,
                    currency: 'INR',
                    receipt,
                    notes: {
                        mongoOrderId: String(newOrder._id),
                        userId: String(req.user._id),
                    },
                });

                newOrder.razorpayOrderId = razorpayOrder.id;
                await newOrder.save();

                return res.status(201).json({
                    order: newOrder,
                    useRazorpay: true,
                    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
                    razorpayOrderId: razorpayOrder.id,
                    amount: amountPaise,
                    currency: 'INR',
                    appOrderId: String(newOrder._id),
                    customerName: `${firstName} ${lastName}`.trim(),
                    customerEmail: email,
                    customerPhone: phone,
                });
            } catch (rzErr) {
                await Order.findByIdAndDelete(newOrder._id);
                console.error('Razorpay order create:', rzErr);
                return res.status(500).json({
                    message: rzErr?.error?.description || rzErr?.message || 'Razorpay order failed',
                });
            }
        }

        // COD: payment tab complete jab order delivered ho (cash handover) — tab tak pending
        newOrder = new Order({
            user: req.user._id,
            firstName, lastName, phone, email, address, city, zipCode, paymentMethod, subtotal,
            tax, total,
            shipping: shippingCost,
            items: orderItems,
            paymentStatus: 'pending',
            adminVisibleAt: scheduleAdminVisibleAt(),
        })

        await newOrder.save();
        return res.status(201).json({ order: newOrder, checkoutUrl: null })

    } catch (error) {
        console.error("createOrder Error:", error);
        res.status(500).json({ message: "server Error", error: error.message })
    }
};

/** Razorpay success handler — signature verify karke order paid mark */
export const verifyRazorpayPayment = async (req, res) => {
    try {
        const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        if (!orderId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ message: 'Missing Razorpay payment fields' });
        }

        const secret = process.env.RAZORPAY_KEY_SECRET;
        if (!secret) {
            return res.status(500).json({ message: 'Razorpay not configured' });
        }

        const body = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
        if (expected !== razorpay_signature) {
            return res.status(400).json({ message: 'Invalid payment signature' });
        }

        const order = await Order.findOne({
            _id: orderId,
            user: req.user._id,
            razorpayOrderId: razorpay_order_id,
            paymentStatus: 'pending',
        });
        if (!order) {
            return res.status(404).json({ message: 'Order not found or already paid' });
        }

        order.paymentStatus = 'succeeded';
        order.transactionId = razorpay_payment_id;
        order.adminVisibleAt = scheduleAdminVisibleAt();
        await order.save();

        return res.json({ order });
    } catch (err) {
        console.error('verifyRazorpayPayment', err);
        return res.status(500).json({ message: 'Server Error', error: err.message });
    }
};

// CONFIRM PAYMENT kept for backwards compatibility (Stripe flow removed)
export const confirmPayment = async (_req, res) => {
    return res.status(410).json({ message: 'Stripe checkout has been removed. Use Razorpay flow.' });
};

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Add all resolvable lines from a past order into the user’s cart (merge quantities).
 * Resolves dish by menuItemId, else by name match on current menu.
 */
export const reorderFromOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(String(orderId))) {
            return res.status(400).json({ success: false, message: 'Invalid order id' });
        }

        const order = await Order.findOne({ _id: orderId, user: req.user._id });
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        if (order.status === 'cancelled' || order.cancelledAt) {
            return res.status(400).json({
                success: false,
                message: "You can't reorder from a cancelled order.",
            });
        }

        const added = [];
        const skipped = [];

        for (const line of order.items) {
            let itemDoc = null;
            if (line.menuItemId) {
                itemDoc = await Item.findById(line.menuItemId);
            }
            if (!itemDoc && line.item?.name) {
                const rawName = String(line.item.name).trim();
                itemDoc = await Item.findOne({ name: rawName });
                if (!itemDoc && rawName) {
                    itemDoc = await Item.findOne({
                        name: { $regex: new RegExp(`^${escapeRegex(rawName)}$`, 'i') },
                    });
                }
            }
            if (!itemDoc) {
                skipped.push({
                    name: line.item?.name || 'Unknown',
                    reason: 'No longer on menu',
                });
                continue;
            }
            if (itemDoc.inStock === false) {
                skipped.push({ name: itemDoc.name, reason: 'Out of stock' });
                continue;
            }

            const qty = Math.max(1, Number(line.quantity) || 1);
            let cartItem = await CartItem.findOne({ user: req.user._id, item: itemDoc._id });
            if (cartItem) {
                cartItem.quantity += qty;
                await cartItem.save();
                await cartItem.populate('item');
                added.push({ name: itemDoc.name, quantity: qty, cartQuantity: cartItem.quantity });
            } else {
                cartItem = await CartItem.create({
                    user: req.user._id,
                    item: itemDoc._id,
                    quantity: qty,
                });
                await cartItem.populate('item');
                added.push({ name: itemDoc.name, quantity: qty, cartQuantity: qty });
            }
        }

        if (added.length === 0) {
            return res.status(400).json({
                success: false,
                message:
                    'No items could be added. They may have been removed from the menu or are out of stock.',
                skipped,
            });
        }

        return res.json({
            success: true,
            message: `Added ${added.length} line(s) to your cart. Open cart to review and checkout.`,
            added,
            skipped,
        });
    } catch (err) {
        console.error('reorderFromOrder', err);
        return res.status(500).json({
            success: false,
            message: err?.message || 'Could not reorder. Please try again.',
        });
    }
};

/** Grace ke andar user order cancel (sirf khud ka) */
export const cancelUserOrder = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(String(id))) {
            return res.status(400).json({ message: 'Invalid order id' });
        }
        const order = await Order.findOne({ _id: id, user: req.user._id });
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        if (order.status === 'cancelled' || order.cancelledAt) {
            return res.status(400).json({ message: 'Order already cancelled' });
        }
        if (!order.adminVisibleAt) {
            return res.status(400).json({ message: 'This order cannot be cancelled from here.' });
        }
        if (Date.now() >= new Date(order.adminVisibleAt).getTime()) {
            return res.status(400).json({ message: 'Time over — order is now with the restaurant.' });
        }
        order.status = 'cancelled';
        order.cancelledAt = new Date();
        await order.save();
        return res.json({ success: true, order });
    } catch (err) {
        console.error('cancelUserOrder', err);
        return res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// GET ORDER
export const getOrders = async (req, res) => {
    try {
        await cleanupOldOrdersRetention();
        await runOrderTimelineAutoProgress();
        const filter = { user: req.user._id }; // order belong to that particular user
        const rawOrders = await Order.find(filter).sort({ createdAt: -1 }).lean()

        // FORMAT
        const formatted = rawOrders.map(o => ({
            ...o,
            items: o.items.map(i => ({
                _id: i._id,
                menuItemId: i.menuItemId,
                item: i.item,
                quantity: i.quantity,
            })),
            createdAt: o.createdAt,
            paymentStatus: o.paymentStatus,
            adminVisibleAt: o.adminVisibleAt,
            cancelledAt: o.cancelledAt,
        }));

        res.json(formatted)
    }
    catch (error) {
        console.error("createOrder Error:", error);
        res.status(500).json({ message: "server Error", error: error.message })
    }
}

// ADMIN ROUTE GET ALL ORDERS
export const getAllOrders = async (req, res) => {
    try {
        await cleanupOldOrdersRetention();
        await runOrderTimelineAutoProgress();
        const raw = await Order
            .find(adminVisibleOrderFilter())
            .sort({ createdAt: -1 })
            .lean()

        const formatted = raw.map(o => ({
            _id: o._id,
            user: o.user,
            firstName: o.firstName,
            lastName: o.lastName,
            email: o.email,
            phone: o.phone,
            address: o.address ?? o.shippingAddress?.address ?? '',
            city: o.city ?? o.shippingAddress?.city ?? '',
            zipCode: o.zipCode ?? o.shippingAddress?.zipCode ?? '',

            paymentMethod: o.paymentMethod,
            paymentStatus: o.paymentStatus,
            status: o.status,
            createdAt: o.createdAt,
            adminVisibleAt: o.adminVisibleAt,

            items: o.items.map(i => ({
                _id: i._id,
                item: i.item,
                quantity: i.quantity
            }))
        }));
        res.json(formatted)

    } catch (error) {
        console.error("getAllOrders Error:", error);
        res.status(500).json({ message: "server Error", error: error.message })
    }
}


// UPDATE ORDER WITHOUT TOKEN FOR ADMIN
export const updateAnyOrder = async (req, res) => {
    try {
        const existing = await Order.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const body = { ...req.body };
        const newStatus = body.status;
        delete body.status;

        if (newStatus === 'delivered') {
            return res.status(400).json({
                message: 'Delivered status is automatic after the order is out for delivery for the configured time.',
            });
        }

        // Online: pay pehle; COD: cash delivery par — out for delivery bina online pay ke sirf COD
        if (newStatus === 'outForDelivery' && existing.paymentStatus !== 'succeeded') {
            if (existing.paymentMethod !== 'cod') {
                return res.status(400).json({
                    message: 'Out for delivery only after payment is successful.',
                });
            }
        }

        const patch = { ...body };

        if (newStatus !== undefined) {
            patch.status = newStatus;
            if (newStatus === 'outForDelivery') {
                patch.outForDeliveryAt = new Date();
            } else if (newStatus === 'processing' || newStatus === 'cancelled') {
                patch.outForDeliveryAt = null;
            }
        }

        const updated = await Order.findByIdAndUpdate(
            req.params.id,
            patch,
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ message: 'Order not found' })
        }

        res.json(updated)
    }
    catch (error) {
        console.error("updateAnyOrder Error:", error);
        res.status(500).json({ message: "server Error", error: error.message })
    }
}

// DELETE ORDER FOR ADMIN
export const deleteAnyOrder = async (req, res) => {
    try {
        const deleted = await Order.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: 'Order not found' });
        return res.json({ success: true, deletedId: String(req.params.id) });
    } catch (error) {
        console.error("deleteAnyOrder Error:", error);
        res.status(500).json({ message: "server Error", error: error.message });
    }
}

/**
 * Sirf paid + `outForDelivery` orders ko, dispatch ke baad AUTO `delivered` karta hai.
 * Out for delivery admin set karta hai; processing/cancelled bhi admin.
 */
export async function runOrderTimelineAutoProgress() {
    const now = Date.now();
    // outForDelivery: online already succeeded; COD can be pending until delivered
    const all = await Order.find({
        status: 'outForDelivery',
    }).lean();

    let updatedCount = 0;

    for (const o of all) {
        const visAt = o.adminVisibleAt ? new Date(o.adminVisibleAt).getTime() : 0;
        if (visAt && now < visAt) continue;

        const startMs = o.outForDeliveryAt
            ? new Date(o.outForDeliveryAt).getTime()
            : new Date(o.updatedAt || o.createdAt).getTime();

        if (!Number.isFinite(startMs)) continue;
        if (now - startMs < AUTO_DELIVER_AFTER_OUT_MS) continue;

        const patch = {
            status: 'delivered',
            deliveredAt: new Date(),
        };
        // COD: delivery = user ne cash diya → payment complete
        if (String(o.paymentMethod) === 'cod' && o.paymentStatus === 'pending') {
            patch.paymentStatus = 'succeeded';
        }

        await Order.findByIdAndUpdate(o._id, patch);
        updatedCount++;
    }

    return { updatedCount };
}


//GET ORDER BY ID
export const getOrderById = async (req, res) => {
    try {
        await runOrderTimelineAutoProgress();
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        if (!order.user.equals(req.user._id)) {
            return res.status(403).json({ message: 'Access Denied' })
        }

        if (req.query.email && order.email !== req.query.email) {
            return res.status(403).json({ message: 'Access Denied' })
        }

        res.json(order)
    }
    catch (error) {
        console.error('hetOrderById Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message })
    }
}

// UPDATE BY ID

export const UpdateOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        if (!order.user.equals(req.user._id)) {
            return res.status(403).json({ message: 'Access Denied' })
        }

        if (req.body.email && order.email !== req.body.email) {
            return res.status(403).json({ message: 'Access Denied' })
        }

        const updated = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(updated)

    }
    catch (error) {
        console.error('hetOrderById Error:', error);
        res.status(500).json({ message: 'Server Error', error: error.message })
    }
}


