const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join('/tmp', 'unihub-data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file, fallback = []) {
  try {
    const filePath = path.join(DATA_DIR, file);
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(file, data) {
  try {
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Could not write temporary app data:', error.message);
    return false;
  }
}
function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}
function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON request body')); }
    });
    req.on('error', reject);
  });
}

// Vercel invokes this exported handler per request. Do not call server.listen()
// from a serverless function.
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJSON(res, 204, {});
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;
  try {
    if (pathname === '/api/items' && req.method === 'GET') {
      let items = readJSON('items.json', []);
      const search = parsed.searchParams.get('search');
      const category = parsed.searchParams.get('category');
      const condition = parsed.searchParams.get('condition');
      const sort = parsed.searchParams.get('sort');
      const status = parsed.searchParams.get('status');
      const sellerId = parsed.searchParams.get('sellerId');
      if (status) items = items.filter(item => item.status === status);
      if (sellerId) items = items.filter(item => item.sellerId === sellerId);
      if (category && category !== 'All') items = items.filter(item => (item.category || '').toLowerCase() === category.toLowerCase());
      if (condition && condition !== 'All') items = items.filter(item => (item.condition || '').toLowerCase() === condition.toLowerCase());
      if (search) {
        const query = search.toLowerCase();
        items = items.filter(item => [item.title, item.description, item.courseCode, item.location].some(value => (value || '').toLowerCase().includes(query)));
      }
      if (sort === 'price-low') items.sort((a, b) => a.price - b.price);
      else if (sort === 'price-high') items.sort((a, b) => b.price - a.price);
      else if (sort === 'savings') items.sort((a, b) => ((b.originalPrice - b.price) / (b.originalPrice || 1)) - ((a.originalPrice - a.price) / (a.originalPrice || 1)));
      else items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return sendJSON(res, 200, { success: true, count: items.length, items });
    }

    if (pathname === '/api/items' && req.method === 'POST') {
      const body = await getRequestBody(req);
      if (!body.title || !Number(body.price) || !body.category) return sendJSON(res, 400, { success: false, message: 'Title, price, and category are required' });
      const items = readJSON('items.json', []);
      const item = {
        id: 'item-' + Date.now(), title: String(body.title).trim(), category: body.category,
        price: Number(body.price), originalPrice: Number(body.originalPrice) || Number(body.price),
        condition: body.condition || 'Good', description: body.description || '',
        courseCode: (body.courseCode || '').toUpperCase().trim(), location: body.location || 'Central Library',
        images: Array.isArray(body.images) && body.images.length ? body.images : ['https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=800&q=80'],
        sellerId: body.sellerId || 'user-demo', sellerName: body.sellerName || 'Campus Student',
        sellerHostel: body.sellerHostel || 'Campus', sellerRating: 5, status: 'available', createdAt: new Date().toISOString()
      };
      items.unshift(item);
      writeJSON('items.json', items);
      return sendJSON(res, 201, { success: true, item });
    }

    const itemMatch = pathname.match(/^\/api\/items\/([a-zA-Z0-9_-]+)$/);
    if (itemMatch && req.method === 'PUT') {
      const items = readJSON('items.json', []), index = items.findIndex(item => item.id === itemMatch[1]);
      if (index < 0) return sendJSON(res, 404, { success: false, message: 'Item not found' });
      items[index] = { ...items[index], ...(await getRequestBody(req)), id: items[index].id };
      writeJSON('items.json', items);
      return sendJSON(res, 200, { success: true, item: items[index] });
    }
    if (itemMatch && req.method === 'DELETE') {
      const items = readJSON('items.json', []), updated = items.filter(item => item.id !== itemMatch[1]);
      if (updated.length === items.length) return sendJSON(res, 404, { success: false, message: 'Item not found' });
      writeJSON('items.json', updated);
      return sendJSON(res, 200, { success: true });
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await getRequestBody(req), users = readJSON('users.json', []);
      const email = String(body.email || 'student@campus.edu').trim().toLowerCase();
      let user = users.find(entry => (entry.email || '').toLowerCase() === email);
      if (!user) {
        user = { id: 'user-' + Date.now().toString().slice(-6), name: body.name || email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, char => char.toUpperCase()), email, studentId: 'STU' + Math.floor(100000 + Math.random() * 900000), hostel: 'Campus', verified: true, rating: 5, tradesCompleted: 0 };
        users.push(user);
        writeJSON('users.json', users);
      }
      return sendJSON(res, 200, { success: true, user });
    }

    if (pathname === '/api/orders' && req.method === 'POST') {
      const body = await getRequestBody(req), items = readJSON('items.json', []);
      const index = items.findIndex(item => item.id === body.itemId);
      if (index < 0) return sendJSON(res, 404, { success: false, message: 'Item not found' });
      if (items[index].status !== 'available') return sendJSON(res, 409, { success: false, message: 'This listing is no longer available' });
      const item = items[index], paymentMethod = body.paymentMethod || 'Pay at handover';
      const order = {
        id: 'ord-' + Date.now(), transactionId: 'TXN-' + Math.random().toString(36).slice(2, 9).toUpperCase(),
        itemId: item.id, itemTitle: item.title, itemImage: (item.images || [])[0], amount: item.price,
        paymentMethod, paymentStatus: paymentMethod.includes('Meetup') ? 'Pending Handover' : 'Paid Confirmed',
        orderStatus: 'Ready for Handover', buyerId: body.buyerId || 'user-demo', buyerName: body.buyerName || 'Student',
        sellerId: item.sellerId, sellerName: item.sellerName, sellerHostel: item.sellerHostel,
        meetupLocation: body.meetupLocation || item.location, meetupTime: body.meetupTime || 'Arrange by chat',
        otp: String(Math.floor(1000 + Math.random() * 9000)), createdAt: new Date().toISOString()
      };
      items[index].status = 'reserved';
      writeJSON('items.json', items);
      const orders = readJSON('orders.json', []);
      orders.unshift(order);
      writeJSON('orders.json', orders);
      return sendJSON(res, 201, { success: true, order });
    }
    if (pathname === '/api/orders' && req.method === 'GET') {
      const orders = readJSON('orders.json', []), userId = parsed.searchParams.get('userId');
      const filtered = userId ? orders.filter(order => order.buyerId === userId || order.sellerId === userId) : orders;
      return sendJSON(res, 200, { success: true, count: filtered.length, orders: filtered });
    }
    if (pathname === '/api/stats' && req.method === 'GET') {
      const items = readJSON('items.json', []), users = readJSON('users.json', []), orders = readJSON('orders.json', []);
      return sendJSON(res, 200, { success: true, stats: { activeListings: items.filter(item => item.status === 'available').length, verifiedStudents: users.length, tradesCompleted: orders.filter(order => order.orderStatus === 'Completed').length, totalSavingsInr: items.reduce((sum, item) => sum + Math.max(0, (item.originalPrice || 0) - item.price), 0) } });
    }

    const chatMatch = pathname.match(/^\/api\/chat\/([a-zA-Z0-9_-]+)$/);
    if (chatMatch) {
      const chats = readJSON('chats.json', []);
      let chat = chats.find(entry => entry.itemId === chatMatch[1]);
      if (req.method === 'GET') return sendJSON(res, 200, { success: true, chat: chat || { itemId: chatMatch[1], messages: [] } });
      if (req.method === 'POST') {
        const body = await getRequestBody(req), text = String(body.text || '').trim();
        if (!text) return sendJSON(res, 400, { success: false, message: 'Message cannot be empty' });
        const message = { id: 'msg-' + Date.now(), senderId: body.senderId || 'user-demo', senderName: body.senderName || 'Student', text: text.slice(0, 500), timestamp: new Date().toISOString() };
        if (!chat) { chat = { id: 'chat-' + chatMatch[1], itemId: chatMatch[1], messages: [] }; chats.push(chat); }
        chat.messages.push(message);
        writeJSON('chats.json', chats);
        return sendJSON(res, 201, { success: true, message });
      }
    }
    return sendJSON(res, 404, { success: false, message: 'API route not found' });
  } catch (error) {
    console.error('UniHub API error:', error);
    return sendJSON(res, 500, { success: false, message: error.message || 'Internal server error' });
  }
};
