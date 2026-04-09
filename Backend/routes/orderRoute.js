import express from 'express';
import { cancelUserOrder, confirmPayment, createOrder, deleteAnyOrder, getAllOrders, getOrderById, getOrders, reorderFromOrder, updateAnyOrder, UpdateOrder, verifyRazorpayPayment } from '../Controllers/oredrController.js';
import authMiddleware from '../middleware/auth.js';
import adminAuthMiddleware from '../middleware/adminAuth.js';

const OrderRoute = express.Router();

OrderRoute.get('/getall', adminAuthMiddleware, getAllOrders)
OrderRoute.put('/getall/:id', adminAuthMiddleware, updateAnyOrder)
OrderRoute.delete('/getall/:id', adminAuthMiddleware, deleteAnyOrder)
//PROTECT REST OF ROUTES USINING MIDDLEWARE
OrderRoute.use(authMiddleware)

OrderRoute.post('/', createOrder)
OrderRoute.post('/reorder/:orderId', reorderFromOrder)
OrderRoute.post('/razorpay-verify', verifyRazorpayPayment)
OrderRoute.post('/:id/cancel', cancelUserOrder)
OrderRoute.get('/', getOrders)
OrderRoute.get('/confirm', confirmPayment)
OrderRoute.get('/:id', getOrderById)
OrderRoute.put('/:id', UpdateOrder)

export default OrderRoute;
