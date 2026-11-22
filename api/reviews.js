import { randomBytes } from 'node:crypto';
import { getDb, json, methodNotAllowed, handleError, currentUser } from './_lib/db.js';

export default async function handler(req,res){
  try{
    const sql=getDb();
    if(req.method==='GET'){
      const rows=await sql`SELECT id,rental_id AS "rentalId",motor_id AS "motorId",buyer_id AS "buyerId",seller_id AS "sellerId",rating,comment,created_at AS "createdAt" FROM reviews ORDER BY created_at DESC`;
      return json(res,200,{reviews:rows});
    }
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    if(req.method==='POST'){
      if(user.role!=='buyer')return json(res,403,{error:'Only buyers can submit reviews.'});
      const {rentalId,rating,comment=''}=req.body||{};
      const score=Number(rating);
      if(typeof rentalId!=='string'||!Number.isInteger(score)||score<1||score>5)return json(res,400,{error:'A completed rental and rating from 1 to 5 are required.'});
      const [r]=await sql`SELECT id,motor_id,buyer_id,seller_id,status FROM rentals WHERE id=${rentalId}`;
      if(!r||r.buyer_id!==user.id||r.status!=='completed')return json(res,403,{error:'You may review only your completed rentals.'});
      const id=`rv_${randomBytes(16).toString('hex')}`;
      const [review]=await sql`INSERT INTO reviews (id,rental_id,motor_id,buyer_id,seller_id,rating,comment) VALUES (${id},${r.id},${r.motor_id},${r.buyer_id},${r.seller_id},${score},${String(comment).slice(0,2000)}) ON CONFLICT (rental_id) DO NOTHING RETURNING id,rental_id AS "rentalId",motor_id AS "motorId",buyer_id AS "buyerId",seller_id AS "sellerId",rating,comment,created_at AS "createdAt"`;
      if(!review)return json(res,409,{error:'This rental already has a review.'});
      return json(res,201,{review});
    }
    if(req.method==='DELETE'){
      if(user.role!=='admin')return json(res,403,{error:'Admin access required.'});
      const {id}=req.body||{};
      if(typeof id!=='string')return json(res,400,{error:'Review id is required.'});
      await sql`DELETE FROM reviews WHERE id=${id}`;
      return json(res,200,{ok:true});
    }
    return methodNotAllowed(res,['GET','POST','DELETE']);
  }catch(error){return handleError(res,error);}
}
