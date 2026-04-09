import React, { useCallback, useEffect, useState, useRef } from 'react'
import { layoutClasses, tableClasses, statusStyles, paymentMethodDetails, iconMap } from '../assets/dummyadmin'
import adminClient from '../api/adminClient';
import { FiBox, FiCheckCircle, FiUser } from 'react-icons/fi';

/** User grace 5s ke baad order admin list mein aata hai — bina refresh live dikhane ke liye */
const ORDERS_POLL_MS = 800;

const Order = () => {

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  /** Popup when an order becomes delivered (customer received) while this screen is open */
  const [deliveredNotice, setDeliveredNotice] = useState(null);

  const prevStatusesRef = useRef({});
  const hasInitializedSnapshotRef = useRef(false);

  const mapOrders = (raw) =>
    raw.map(order => ({
      ...order,
      address: order.address ?? order.shippingAddress?.address ?? '',
      city: order.city ?? order.shippingAddress?.city ?? '',
      zipCode: order.zipCode ?? order.shippingAddress?.zipCode ?? '',
      phone: order.phone ?? '',
      items: order.items?.map(e => ({
        _id: e._id,
        item: e.item,
        quantity: e.quantity
      })) || [],
      createdAt: new Date(order.createdAt).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));

  const fetchOrders = useCallback(async ({ silent } = {}) => {
    try {
      if (!silent) setLoading(true);
      const response = await adminClient.get('/api/orders/getall');
      const mapped = mapOrders(response.data || []);

      const prev = prevStatusesRef.current;
      if (hasInitializedSnapshotRef.current) {
        const newlyDelivered = [];
        for (const o of mapped) {
          const id = String(o._id);
          const oldS = prev[id];
          if (oldS != null && oldS !== 'delivered' && o.status === 'delivered') {
            newlyDelivered.push(o);
          }
        }
        if (newlyDelivered.length > 0) {
          setDeliveredNotice({ orders: newlyDelivered });
        }
      }

      const next = {};
      for (const o of mapped) {
        next[String(o._id)] = o.status;
      }
      prevStatusesRef.current = next;
      hasInitializedSnapshotRef.current = true;

      setOrders(mapped);
      setError(null);
    }
    catch (err) {
      if (!silent) setError(err.response?.data?.message || 'Failed to load orders.');
    }
    finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await fetchOrders({ silent: false });
    };
    run();

    const id = setInterval(() => {
      if (!cancelled) fetchOrders({ silent: true });
    }, ORDERS_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchOrders]);

  const handleStatusChange = async (orderId, newStatus) => {
    try {
      await adminClient.put(`/api/orders/getall/${orderId}`, { status: newStatus });
      await fetchOrders({ silent: true });
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update order status');
    }
  };

  if (error) return (
    <div className={`${layoutClasses.page} flex items-center justify-center`}>
      <div className="text-red-400 text-xl font-semibold">{error}</div>
    </div>
  )

  return (
    <>
      {/* Portal-free: render outside blurred card so fixed overlay is viewport-centered */}
      {deliveredNotice && deliveredNotice.orders?.length > 0 && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-delivered-title"
          onClick={() => setDeliveredNotice(null)}
        >
          <div
            className="mx-auto w-full max-w-md shrink-0 rounded-2xl border border-emerald-500/35 bg-[#1a241f] p-6 text-center shadow-2xl shadow-emerald-950/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
              <FiCheckCircle className="text-3xl text-emerald-400" aria-hidden />
            </div>
            <h3
              id="admin-delivered-title"
              className={`${layoutClasses.heading} text-lg text-emerald-100 sm:text-xl`}
            >
              Customer received the order
            </h3>
            <p className="mt-3 text-sm text-amber-100/80">
              {deliveredNotice.orders.length === 1
                ? 'This order is now marked delivered — the customer has received it.'
                : `${deliveredNotice.orders.length} orders are now marked delivered — customers have received them.`}
            </p>
            <ul className="mt-4 max-h-40 space-y-2 overflow-y-auto rounded-xl border border-emerald-500/20 bg-black/25 px-3 py-3 text-left text-sm">
              {deliveredNotice.orders.map((o) => {
                const total =
                  o.total ??
                  o.items?.reduce((s, i) => s + (i.item?.price || 0) * (i.quantity || 0), 0);
                const name = [o.firstName, o.lastName].filter(Boolean).join(' ') || 'Customer';
                return (
                  <li key={o._id} className="border-b border-amber-500/10 pb-2 last:border-0 last:pb-0">
                    <span className="font-mono text-amber-200">#{String(o._id).slice(-8)}</span>
                    <span className="mx-2 text-amber-500/50">·</span>
                    <span className="text-amber-100/90">{name}</span>
                    {o.phone ? (
                      <span className="mt-0.5 block text-xs text-amber-400/70">{o.phone}</span>
                    ) : null}
                    <span className="mt-1 block text-xs font-medium text-emerald-200/90">
                      ₹{Number(total || 0).toFixed(2)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              className="mt-5 w-full rounded-xl border border-emerald-600/45 bg-emerald-800/35 py-3 font-cinzel text-sm font-semibold text-emerald-50 transition hover:bg-emerald-700/40"
              onClick={() => setDeliveredNotice(null)}
            >
              OK
            </button>
          </div>
        </div>
      )}

    <div className={`${layoutClasses.page} p-4 sm:p-6`}>
      <div className="mx-auto max-w-7xl w-full">
        <div className={`${layoutClasses.card} p-4 sm:p-6`}>

          <h2 className={`${layoutClasses.heading} mb-6 text-center sm:text-left`}>
            Orders Management
          </h2>

          <div className={`${tableClasses.wrapper} w-full`}>
            <table className={`${tableClasses.table} min-w-[900px]`}>

              <thead className={`${tableClasses.headerRow}`}>
                <tr>
                  {['Order ID', 'Customer', 'Address', 'Items', 'Total Items', 'Price', 'Payment', 'Status'].map(h => (
                    <th
                      key={h}
                      className={`${tableClasses.headerCell} whitespace-nowrap ${h === 'Total Items' ? 'text-center' : 'text-left'}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>

                {orders.map(order => {

                  const totalItems = order.items.reduce((s, i) => s + i.quantity, 0);

                  const totalPrice =
                    order.total ??
                    order.items.reduce((s, i) => s + i.item.price * i.quantity, 0);

                  const payMethod =
                    paymentMethodDetails[order.paymentMethod?.toLowerCase()] ||
                    paymentMethodDetails.default;

                  const payStatusStyle =
                    statusStyles[order.paymentStatus] ||
                    statusStyles.processing;

                  const stat =
                    statusStyles[order.status] ||
                    statusStyles.processing;

                  return (

                    <tr
                      key={order._id}
                      className={`${tableClasses.row} hover:bg-amber-500/5 transition`}
                    >

                      <td className={`${tableClasses.cellBase} font-mono text-sm text-amber-100`}>
                        #{order._id.slice(-8)}
                      </td>


                      {/* Customer */}
                      <td className={`${tableClasses.cellBase}`}>
                        <div className="flex items-start gap-3">

                          <FiUser className="text-amber-400 mt-1 shrink-0" />

                          <div className="space-y-0.5">

                            <p className="text-amber-100 font-medium">
                              {order.user?.name || order.firstName + ' ' + order.lastName}
                            </p>

                            <p className="text-xs text-amber-400/70">
                              {order.user?.phone || order.phone}
                            </p>

                            <p className="text-xs text-amber-400/70 break-all">
                              {order.user?.email || order.email}
                            </p>

                          </div>

                        </div>
                      </td>


                      {/* Address */}
                      <td className={`${tableClasses.cellBase}`}>
                        <div className="text-amber-100/80 text-sm max-w-[220px] break-words">
                          {order.address}, {order.city} - {order.zipCode}
                        </div>
                      </td>


                      {/* Items */}
                      <td className={`${tableClasses.cellBase}`}>
                        <div className="ff-scrollbar max-h-52 space-y-2 overflow-y-auto overscroll-contain pr-1">

                          {order.items.map((itm, idx) => (

                            <div
                              key={idx}
                              className="flex items-center gap-2 p-2 rounded-lg hover:bg-amber-500/5 transition"
                            >

                              <div className="flex-1 min-w-0">

                                <span className="text-amber-100 text-sm truncate block">
                                  {itm.item.name}
                                </span>

                                <div className="flex items-center gap-2 text-xs text-amber-400/70">

                                  <span>₹{itm.item.price.toFixed(2)}</span>

                                  <span>•</span>

                                  <span>x{itm.quantity}</span>

                                </div>

                              </div>

                            </div>

                          ))}

                        </div>
                      </td>


                      {/* Total Items */}
                      <td className={`${tableClasses.cellBase} text-center`}>
                        <div className="flex items-center justify-center gap-1">

                          <FiBox className="text-amber-400" />

                          <span className="text-amber-300 font-semibold">
                            {totalItems}
                          </span>

                        </div>
                      </td>


                      {/* Price */}
                      <td className={`${tableClasses.cellBase} text-amber-300 font-semibold whitespace-nowrap`}>
                        ₹{totalPrice.toFixed(2)}
                      </td>


                      {/* Payment */}
                      <td className={`${tableClasses.cellBase}`}>
                        <div className="flex flex-col gap-2">

                          <div className={`${payMethod.class} px-3 py-1 rounded-lg border text-xs font-medium w-fit`}>
                            {payMethod.label}
                          </div>

                          <div className={`${payStatusStyle.color} flex items-center gap-2 text-xs font-medium`}>
                            {iconMap[payStatusStyle.icon]}
                            {payStatusStyle.label}
                          </div>

                        </div>
                      </td>


                      {/* Status: admin sets dispatch; delivered is auto */}
                      <td className={`${tableClasses.cellBase}`}>
                        <div className="flex items-center gap-2">
                          <span className={`${stat.color}`}>
                            {iconMap[stat.icon]}
                          </span>
                          {order.status === 'delivered' ? (
                            <span
                              className={`inline-flex items-center rounded-lg border border-amber-500/20 px-3 py-1 text-xs font-medium ${stat.bg} ${stat.color}`}
                            >
                              {stat.label}
                            </span>
                          ) : (
                            <select
                              value={order.status}
                              onChange={(e) => handleStatusChange(order._id, e.target.value)}
                              className={`px-3 py-1 rounded-lg ${stat.bg} ${stat.color} border border-amber-500/20 text-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/40`}
                            >
                              {Object.entries(statusStyles)
                                .filter(([k]) => !['succeeded', 'delivered'].includes(k))
                                .map(([key, sty]) => (
                                  <option value={key} key={key} className={`${sty.bg} ${sty.color}`}>
                                    {sty.label}
                                  </option>
                                ))}
                            </select>
                          )}
                        </div>
                      </td>

                    </tr>

                  );

                })}

              </tbody>

            </table>
          </div>


          {orders.length === 0 && !loading &&
            <div className="text-center text-amber-100/60 py-12 text-lg">
              No orders found.
            </div>
          }

        </div>
      </div>
    </div>
    </>
  )
}

export default Order
