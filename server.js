const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./src/config/db');
const authRoutes = require('./src/routes/authRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const appDataRoutes = require('./src/routes/appDataRoutes');
const locationRoutes = require('./src/routes/locationRoutes');
const trackingRoutes = require('./src/routes/trackingRoutes');
const verificationRoutes = require('./src/routes/verificationRoutes');
const invitationRoutes = require('./src/routes/invitationRoutes');
const pharmaRoutes = require('./src/routes/pharmaRoutes');
const retailRoutes = require('./src/routes/retailRoutes');
const whatsappRoutes = require('./src/whatsapp/whatsapp');
const whatsappOrderRoutes = require('./src/routes/whatsappOrderRoutes');
const publicOrderTrackingRoutes = require('./src/routes/publicOrderTrackingRoutes');
const { initializeSocket } = require('./src/services/socketService');
const { ensureLegacyOrganization } = require('./src/services/organizationBootstrapService');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

const corsOptions = process.env.CLIENT_URL
  ? {
      origin: process.env.CLIENT_URL,
      credentials: true,
    }
  : {};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'FieldTrack backend is Running.',
    url: 'https://ftrackapi.intellioera.com'
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Server is running' });
});



app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/app-data', appDataRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/verifications', verificationRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/pharma', pharmaRoutes);
app.use('/api/public/order-tracking', publicOrderTrackingRoutes);
app.use('/api/retail', retailRoutes);
app.use(whatsappOrderRoutes);
app.use(whatsappRoutes);

const startServer = async () => {
  await connectDB();
  await ensureLegacyOrganization();

  initializeSocket(server);

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();
