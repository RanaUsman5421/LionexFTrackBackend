const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./src/config/database/db');
const authRoutes = require('./src/routes/auth/authRoutes');
const adminRoutes = require('./src/routes/admin/adminRoutes');
const appDataRoutes = require('./src/routes/sync/appDataRoutes');
const locationRoutes = require('./src/routes/tracking/locationRoutes');
const trackingRoutes = require('./src/routes/tracking/trackingRoutes');
const verificationRoutes = require('./src/routes/tracking/verificationRoutes');
const invitationRoutes = require('./src/routes/auth/invitationRoutes');
const pharmaRoutes = require('./src/routes/pharmaceutical/pharmaRoutes');
const retailRoutes = require('./src/routes/retail/retailRoutes');
const whatsappRoutes = require('./src/whatsapp/whatsapp');
const whatsappOrderRoutes = require('./src/routes/whatsapp/whatsappOrderRoutes');
const publicOrderTrackingRoutes = require('./src/routes/public/publicOrderTrackingRoutes');
const { initializeSocket } = require('./src/services/realtime/socketService');
const { ensureLegacyOrganization } = require('./src/services/organization/organizationBootstrapService');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;
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



app.use('/api', require('./src/routes/updates/appReleaseRoutes'));
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
  // Complete legacy migration before accepting any app/dashboard writes.
  await require('./src/services/sync/snapshotMigrationService').migrateAll();

  initializeSocket(server);
  require('./src/services/sync/recordSyncMaintenance').startMaintenance();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch(error => { console.error('Startup failed:', error.message); process.exitCode = 1; });
