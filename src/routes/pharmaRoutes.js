const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const controller = require('../controllers/pharmaController');

const router = express.Router();
router.use(protect);
router.get('/summary', controller.summary);
router.get('/doctors', controller.listDoctors);
router.post('/doctors', controller.createDoctor);
router.patch('/doctors/:doctorId', controller.updateDoctor);
router.get('/products', controller.listProducts);
router.get('/inventory', controller.listInventory);
router.get('/tour-plans', controller.listTourPlans);
router.post('/tour-plans', controller.createTourPlan);
router.patch('/tour-plans/:planId', controller.updateTourPlan);
router.get('/visits', controller.listVisits);
router.get('/visits/:visitId', controller.getVisit);
router.post('/visits', controller.createVisit);

module.exports = router;
