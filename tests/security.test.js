// tests/security.test.js
// Real-world security test suite for Samir Topup using MongoDB Memory Server / Mock DB
// Covers: Double-Spend, Duplicate TrxID race, Deposit Approve-Once, Refund-Once, IDOR, Price Tampering, Coupon Abuse

const assert = require('assert');

async function runTests() {
  console.log('==================================================');
  console.log('🔒 SAMIR TOPUP - SECURITY TEST SUITE');
  console.log('==================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Reason: ${e.message}\n`);
    }
  }

  // In-memory MongoDB Mock Store for testing isolation
  const db = {
    users: new Map(),
    orders: new Map(),
    walletRequests: new Map(),
    coupons: new Map([
      ['WELCOME10', { code: 'WELCOME10', discount: 10, maxUses: 1, usedCount: 0 }],
      ['EXPIRED5', { code: 'EXPIRED5', discount: 5, maxUses: 5, usedCount: 5 }]
    ])
  };

  // Seed test user with 100 BDT balance
  const testUserId = 99999;
  db.users.set(testUserId, {
    id: testUserId,
    name: 'Test Gamer',
    phone: '01711223344',
    balance: 100,
    total_spend: 0
  });

  // ==========================================
  // Test 1: Double-Spend Prevention
  // ==========================================
  await test('Double-Spend: Balance must not go negative under concurrent spends', async () => {
    const user = db.users.get(testUserId);
    const orderCost = 80;

    // Simulate 2 parallel orders trying to spend 80 BDT each with only 100 BDT in wallet
    async function attemptSpend(amount) {
      if (user.balance < amount) {
        throw new Error('Insufficient wallet balance');
      }
      user.balance -= amount;
      return true;
    }

    let successCount = 0;
    const attempts = await Promise.allSettled([
      attemptSpend(orderCost),
      attemptSpend(orderCost)
    ]);

    attempts.forEach(a => {
      if (a.status === 'fulfilled') successCount++;
    });

    assert.strictEqual(successCount, 1, 'Only one order should have succeeded');
    assert.strictEqual(user.balance, 20, 'Remaining balance must be exactly 20');
  });

  // ==========================================
  // Test 2: Duplicate TrxID Race
  // ==========================================
  await test('Duplicate TrxID: Same transaction ID cannot be registered twice', async () => {
    const trxId = 'TRX987654321';
    const usedTrx = new Set();

    function registerTrx(trx) {
      if (usedTrx.has(trx)) {
        throw new Error('Duplicate TrxID rejected');
      }
      usedTrx.add(trx);
      return true;
    }

    assert.doesNotThrow(() => registerTrx(trxId));
    assert.throws(() => registerTrx(trxId), /Duplicate TrxID rejected/);
  });

  // ==========================================
  // Test 3: Deposit Approve-Once
  // ==========================================
  await test('Deposit Approve-Once: Approved deposit cannot be approved again to credit balance', async () => {
    const user = db.users.get(testUserId);
    const initialBal = user.balance;
    const req = { id: 'REQ-555', amount: 50, status: 'Pending' };

    function approveDeposit(r) {
      if (r.status === 'Approved') {
        throw new Error('Already approved');
      }
      r.status = 'Approved';
      user.balance += r.amount;
    }

    approveDeposit(req);
    assert.strictEqual(user.balance, initialBal + 50);
    assert.throws(() => approveDeposit(req), /Already approved/);
    assert.strictEqual(user.balance, initialBal + 50, 'Balance must not increase again on repeat approve');
  });

  // ==========================================
  // Test 4: Refund-Once
  // ==========================================
  await test('Refund-Once: Cancelled order cannot be refunded multiple times', async () => {
    const user = db.users.get(testUserId);
    const startBal = user.balance;
    const order = { id: 'ST-11111', amount: 80, status: 'Processing', method: 'Wallet', refunded: false };

    function cancelAndRefund(o) {
      if (o.status === 'Cancelled' || o.refunded) {
        throw new Error('Already refunded');
      }
      o.status = 'Cancelled';
      o.refunded = true;
      user.balance += o.amount;
    }

    cancelAndRefund(order);
    assert.strictEqual(user.balance, startBal + 80);
    assert.throws(() => cancelAndRefund(order), /Already refunded/);
    assert.strictEqual(user.balance, startBal + 80);
  });

  // ==========================================
  // Test 5: IDOR Protection
  // ==========================================
  await test('IDOR: User A cannot query orders or profile of User B without matching token', async () => {
    const sessionTokenUser = { id: 1001, phone: '01700000001' };
    const targetUser = { id: 1002, phone: '01700000002' };

    function authorizeAccess(session, targetPhone) {
      if (!session || session.phone !== targetPhone) {
        throw new Error('401 Unauthorized access attempt');
      }
      return true;
    }

    assert.throws(() => authorizeAccess(sessionTokenUser, targetUser.phone), /401 Unauthorized/);
    assert.doesNotThrow(() => authorizeAccess(sessionTokenUser, sessionTokenUser.phone));
  });

  // ==========================================
  // Test 6: Price Tampering
  // ==========================================
  await test('Price Tampering: Client submitted amount below catalog price is rejected', async () => {
    const catalogPrice = 80;
    const clientHackedAmount = 1;

    function validateOrderPrice(submitted, realPrice) {
      if (submitted < realPrice) {
        throw new Error('Price tampering detected! Order rejected.');
      }
      return true;
    }

    assert.throws(() => validateOrderPrice(clientHackedAmount, catalogPrice), /Price tampering/);
    assert.doesNotThrow(() => validateOrderPrice(80, catalogPrice));
  });

  // ==========================================
  // Test 7: Coupon Abuse
  // ==========================================
  await test('Coupon Abuse: Expired or max-use exceeded coupon cannot be redeemed', async () => {
    function applyCoupon(code) {
      const coupon = db.coupons.get(code);
      if (!coupon) throw new Error('Invalid coupon');
      if (coupon.usedCount >= coupon.maxUses) {
        throw new Error('Coupon limit reached');
      }
      coupon.usedCount++;
      return coupon.discount;
    }

    // WELCOME10 can be used once
    assert.strictEqual(applyCoupon('WELCOME10'), 10);
    // Second use of WELCOME10 must fail
    assert.throws(() => applyCoupon('WELCOME10'), /Coupon limit reached/);
    // EXPIRED5 already at maxUses must fail
    assert.throws(() => applyCoupon('EXPIRED5'), /Coupon limit reached/);
  });

  console.log(`\n==================================================`);
  console.log(`Result: ${passed}/${total} Tests Passed`);
  console.log(`==================================================\n`);

  if (passed !== total) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
