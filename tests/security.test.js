process.chdir(__dirname + '/../api');
const assert=require('assert');
const db=require('../api/_db'), cr=require('../api/_crypto'), orders=require('../api/orders'), wallet=require('../api/wallet'), auth=require('../api/auth');
const cat=require('../api/_catalog.json');
const prod=Object.keys(cat)[0], pkg=Object.keys(cat[prod])[0], price=cat[prod][pkg][0];
const mk=(method,url,body,tok)=>({method,url,headers:{host:'x',cookie:tok?'samirtopup_session='+encodeURIComponent(tok):''},body});
const call=async(h,req)=>new Promise(async r=>{const res={h:{},status(c){this.c=c;return this},json(b){r({c:this.c||200,b})},end(){r({c:this.c||200})},setHeader(){},getHeader(){}};await h(req,res)});
(async()=>{
  const A={id:'uA',name:'Alice A',phone:'01711223344',email:'',balance:price,total_spend:0,role:'user'};
  const B={id:'uB',name:'Bob B',phone:'01811223344',email:'',balance:0,total_spend:0,role:'user'};
  await db.createUser(A);await db.createUser(B);
  const tA=cr.createSessionToken(A), tB=cr.createSessionToken(B);
  // 1 price tamper: client says amount 1, server must charge catalog price
  let r=await call(orders,mk('POST','/api/orders',{product:prod,package:pkg,playerId:'123456789',amount:1,method:'Wallet'},tA));
  assert.equal(r.c,201); assert.equal(r.b.order.amount,price); console.log('PASS price tamper -> charged',price,'not 1');
  // 2 unknown package rejected (also blocks XSS strings in product/package)
  r=await call(orders,mk('POST','/api/orders',{product:'<img src=x onerror=1>',package:'x',playerId:'123456789',amount:50,method:'bKash',trxId:'ABCD1234XY'},tB));
  assert.equal(r.c,400); console.log('PASS XSS/unknown product rejected');
  // 3 double-spend: 5 parallel orders, balance for exactly one
  await db.creditBalance('uB',price);
  const rs=await Promise.all([1,2,3,4,5].map(()=>call(orders,mk('POST','/api/orders',{product:prod,package:pkg,playerId:'123456789',method:'Wallet'},tB))));
  const ok=rs.filter(x=>x.c===201).length; assert.equal(ok,1); console.log('PASS double-spend: 1 of 5 parallel orders succeeded');
  // 4 IDOR: B reads A's order
  r=await call(orders,mk('GET','/api/orders?id='+(await call(orders,mk('GET','/api/orders',null,tA))).b[0].id,null,tB));
  assert.equal(r.c,403); console.log('PASS order IDOR blocked');
  r=await call(auth,mk('GET','/api/auth?id=uA',null,tB)); assert.equal(r.c,401); console.log('PASS profile IDOR blocked');
  // 5 wallet: NaN/Infinity rejected, valid accepted, approve once, credit by user id
  for(const a of ['abc','1e999','-5',5]){r=await call(wallet,mk('POST','/api/wallet',{amount:a,method:'bKash',trxId:'ZXCV1234QW'},tA));assert.equal(r.c,400);}
  console.log('PASS wallet NaN/Infinity/negative rejected');
  r=await call(wallet,mk('POST','/api/wallet',{amount:100,method:'bKash',trxId:'ZXCV1234QW'},tA));assert.equal(r.c,201);
  const adm=cr.createAdminSessionToken(); const aReq=t=>({method:'PUT',url:'/api/wallet',headers:{host:'x',cookie:'samirtopup_admin_session='+encodeURIComponent(adm)},body:{requestId:r.b.request.id,action:'approve'}});
  const a1=await call(wallet,aReq()),a2=await call(wallet,aReq()); assert.equal(a1.c,200); assert.equal(a2.c,409); console.log('PASS deposit approved once, 2nd approve refused');
  r=await call(wallet,mk('POST','/api/wallet',{amount:100,method:'bKash',trxId:'ZXCV1234QW'},tB)); assert.equal(r.c,400); console.log('PASS duplicate TrxID refused');
  // 6 cancel refunds exactly once
  const oid=(await call(orders,mk('GET','/api/orders',null,tA))).b[0].id; const bal0=(await db.findUser({id:'uA'})).balance;
  const put=s=>call(orders,{method:'PUT',url:'/api/orders',headers:{host:'x',cookie:'samirtopup_admin_session='+encodeURIComponent(adm)},body:{orderId:oid,status:s}});
  await put('Cancelled'); await put('Processing'); await put('Cancelled');
  assert.equal((await db.findUser({id:'uA'})).balance,bal0+price); console.log('PASS refund only once (cancel->reopen->cancel)');
  // 7 captcha token no longer leaks the answer
  const c=cr.generateCaptcha(); const pl=JSON.parse(Buffer.from(c.token.split('.')[0],'base64url').toString());
  assert.ok(!('answer' in pl)); const ans=c.svg.match(/(\d) \+ (\d)/)?null:null; console.log('PASS captcha token has no plaintext answer');
  console.log('\nALL TESTS PASSED');
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
