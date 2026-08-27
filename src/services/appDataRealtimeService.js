const clientsByEmployee = new Map();

const writeEvent = (response, event, data) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
};

const subscribeToAppData = (req, res) => {
  const employeeId = String(req.user.employeeId || '').trim();
  if (!employeeId) {
    res.status(400).json({ success: false, message: 'Employee id is required.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const clients = clientsByEmployee.get(employeeId) || new Set();
  clients.add(res);
  clientsByEmployee.set(employeeId, clients);
  writeEvent(res, 'connected', { employeeId, connectedAt: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    writeEvent(res, 'heartbeat', { timestamp: new Date().toISOString() });
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (!clients.size) clientsByEmployee.delete(employeeId);
  });
};

const emitAppDataChanged = (employeeId, version, source = 'backend') => {
  const payload = { employeeId, version: Number(version || 0), source, timestamp: new Date().toISOString() };
  (clientsByEmployee.get(String(employeeId)) || []).forEach((response) => {
    try {
      writeEvent(response, 'app-data-changed', payload);
    } catch (_) {
      // The close handler removes disconnected clients.
    }
  });
};

module.exports = { emitAppDataChanged, subscribeToAppData };
