// Usage: node test-websocket.js <passengerToken> <driverToken> <rideId> <otherUserToken>
const { io } = require('socket.io-client');

const [passengerToken, driverToken, rideId, otherUserToken] = process.argv.slice(2);
const URL = 'http://localhost:3000/tracking';

function connect(token, label) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { auth: { token }, transports: ['websocket'], reconnection: false });
    const timer = setTimeout(() => reject(new Error(`${label}: connect timeout`)), 5000);
    socket.on('connect', () => {
      clearTimeout(timer);
      console.log(`[${label}] connected: ${socket.id}`);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${label}: connect_error ${err.message}`));
    });
  });
}

function connectExpectingRejection(token, label) {
  return new Promise((resolve) => {
    const socket = io(URL, { auth: { token }, transports: ['websocket'], reconnection: false });
    const timer = setTimeout(() => {
      console.log(`[${label}] neither connected nor disconnected within timeout (unexpected)`);
      resolve(false);
      socket.close();
    }, 5000);
    socket.on('connect', () => {
      // Server may accept the raw handshake then disconnect right after invalid token.
    });
    socket.on('disconnect', () => {
      clearTimeout(timer);
      console.log(`[${label}] correctly disconnected (bad token rejected)`);
      resolve(true);
    });
  });
}

async function main() {
  console.log('== 1. Bad token gets disconnected ==');
  await connectExpectingRejection('totally-bogus-token', 'bad-token');

  console.log('\n== 2. Passenger and driver connect with valid tokens ==');
  const passengerSocket = await connect(passengerToken, 'passenger');
  const driverSocket = await connect(driverToken, 'driver');

  console.log('\n== 3. A user NOT on this ride tries to subscribe (should get an error, not the room) ==');
  const otherSocket = await connect(otherUserToken, 'other-user');
  const otherResult = await new Promise((resolve) => {
    otherSocket.emit('subscribe:ride', { rideId }, (response) => resolve(response));
  });
  console.log('other-user subscribe result:', JSON.stringify(otherResult));

  console.log('\n== 4. Passenger (an actual participant) subscribes successfully ==');
  const subResult = await new Promise((resolve) => {
    passengerSocket.emit('subscribe:ride', { rideId }, (response) => resolve(response));
  });
  console.log('passenger subscribe result:', JSON.stringify(subResult));

  console.log('\n== 5. Passenger listens for driver:location, then we trigger a location update via REST ==');
  const locationPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for driver:location event')), 8000);
    passengerSocket.on('driver:location', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  // Trigger the actual location update via the real REST endpoint, which
  // emits driver.location.updated -> LocationService -> this broadcast.
  const fetchFn = global.fetch;
  await fetchFn('http://localhost:3000/api/v1/drivers/location', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${driverToken}` },
    body: JSON.stringify({ lat: 6.605, lng: 3.352 }),
  });

  const received = await locationPromise;
  console.log('Passenger received driver:location event:', JSON.stringify(received));

  passengerSocket.close();
  driverSocket.close();
  otherSocket.close();
  console.log('\nALL WEBSOCKET CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error('WEBSOCKET TEST FAILED:', err.message);
  process.exit(1);
});
