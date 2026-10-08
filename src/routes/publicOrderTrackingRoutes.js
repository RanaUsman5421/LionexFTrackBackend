const express = require('express');
const { publicTracking } = require('../controllers/pharmaOrderController');

const router = express.Router();
router.get('/:token', publicTracking);

module.exports = router;
