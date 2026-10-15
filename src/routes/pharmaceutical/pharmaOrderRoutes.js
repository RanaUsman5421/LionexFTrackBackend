const express = require('express');
const controller = require('../../controllers/pharmaceutical/pharmaOrderController');

const router = express.Router();
router.get('/', controller.listOrders);
router.get('/revision', controller.orderRevision);
router.get('/:orderId', controller.getOrder);
router.post('/', controller.createOrder);
router.post('/:orderId/claim', controller.claimOrder);
router.patch('/:orderId/status', controller.updateStatus);
router.post('/:orderId/notifications/retry', controller.retryOrderNotification);

module.exports = router;
