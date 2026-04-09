import express from 'express';
import { cancelUserOrder, confirmPayment, createOrder, deleteAnyOrder, getAllOrders, getOrderById, getOrders, reorderFromOrder, updateAnyOrder, UpdateOrder, verifyRazorpayPayment } from '../Controllers/oredrController.js';
import authMiddleware from '../middleware/auth.js';
import adminAuthMiddleware from '../middleware/adminAuth.js';

const orderRoute = express.Router();

orderRoute.get('/getall', adminAuthMiddleware, getAllOrders)
orderRoute.put('/getall/:id', adminAuthMiddleware, updateAnyOrder)
orderRoute.delete('/getall/:id', adminAuthMiddleware, deleteAnyOrder)
//PROTECT REST OF ROUTES USINING MIDDLEWARE
orderRoute.use(authMiddleware)

orderRoute.post('/', createOrder)
orderRoute.post('/reorder/:orderId', reorderFromOrder)
orderRoute.post('/razorpay-verify', verifyRazorpayPayment)
orderRoute.post('/:id/cancel', cancelUserOrder)
orderRoute.get('/', getOrders)
orderRoute.get('/confirm', confirmPayment)
orderRoute.get('/:id', getOrderById)
orderRoute.put('/:id', UpdateOrder)

export default orderRoute;