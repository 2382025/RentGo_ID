import { randomBytes } from 'node:crypto';
import { getDb, json, methodNotAllowed, handleError, currentUser } from './_lib/db.js';

export default async function handler(req,res){
  try{
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    if(req.method==='GET'){
      if(!['seller','admin'].includes(user.role))return json(res,403,{error:'Seller or admin access required.'});
      const rows=user.role==='admin'
        ? await sql`SELECT cp.*,u.name AS seller_name FROM commission_payments cp JOIN users u ON u.id=cp.seller_id ORDER BY cp.submitted_at DESC`
        : await sql`SELECT cp.*,u.name AS seller_name FROM commission_payments cp JOIN users u ON u.id=cp.seller_id WHERE cp.seller_id=${user.id} ORDER BY cp.submitted_at DESC`;
      const result=[];
      for(const cp of rows){
        const links=await sql`SELECT rental_id FROM commission_payment_rentals WHERE commission_payment_id=${cp.id}`;
        result.push({id:cp.id,sellerId:cp.seller_id,sellerName:cp.seller_name,period:cp.period,rentalIds:links.map(x=>x.rental_id),amount:Number(cp.amount),proofPhoto:cp.proof_photo_url,status:cp.status,submittedAt:cp.submitted_at,reviewedAt:cp.reviewed_at,reviewedBy:cp.reviewed_by,adminNote:cp.admin_note,manual:cp.manual});
      }
      return json(res,200,{commissionPayments:result});
    }
    if(req.method==='POST'){
      const b=req.body||{};
      if(b.manual===true&&user.role==='admin'){
        const {sellerId,period,note=''}=b;
        const rentals=await sql`SELECT id,commission FROM rentals WHERE seller_id=${sellerId} AND status='completed' AND commission_paid=false AND commission_pending=false AND to_char(coalesce(completed_at,created_at),'YYYY-MM')=${period}`;
        if(!rentals.length)return json(res,409,{error:'No unpaid completed rentals found for this seller and period.'});
        const id=`cp_${randomBytes(16).toString('hex')}`;
        const amount=rentals.reduce((s,r)=>s+Number(r.commission),0);
        const [cp]=await sql`INSERT INTO commission_payments (id,seller_id,period,amount,status,reviewed_at,reviewed_by,admin_note,manual) VALUES (${id},${sellerId},${period},${amount},'verified',now(),${user.id},${String(note).slice(0,1000)||'Ditandai lunas manual oleh admin'},true) RETURNING *`;
        for(const r of rentals){await sql`INSERT INTO commission_payment_rentals (commission_payment_id,rental_id) VALUES (${id},${r.id})`;}
        await sql`UPDATE rentals SET commission_paid=true,commission_pending=false,commission_paid_at=now(),commission_payment_id=${id} WHERE id=ANY(${rentals.map(r=>r.id)})`;
        return json(res,201,{id:cp.id});
      }
      if(user.role!=='seller')return json(res,403,{error:'Only sellers can submit a commission payment.'});
      const {period,rentalIds,proofPhoto}=b;
      if(typeof period!=='string'||!/^\d{4}-\d{2}$/.test(period)||!Array.isArray(rentalIds)||!rentalIds.length||rentalIds.length>500||typeof proofPhoto!=='string'||proofPhoto.length>1_000_000)return json(res,400,{error:'A period, rental list, and proof image up to 1 MB are required.'});
      const ids=[...new Set(rentalIds.filter(x=>typeof x==='string'))];
      const rentals=await sql`SELECT id,commission FROM rentals WHERE seller_id=${user.id} AND status='completed' AND commission_paid=false AND commission_pending=false AND to_char(coalesce(completed_at,created_at),'YYYY-MM')=${period} AND id=ANY(${ids})`;
      if(!rentals.length||rentals.length!==ids.length)return json(res,409,{error:'Some rentals are not eligible for this commission submission.'});
      const id=`cp_${randomBytes(16).toString('hex')}`;
      const amount=rentals.reduce((s,r)=>s+Number(r.commission),0);
      await sql`INSERT INTO commission_payments (id,seller_id,period,amount,proof_photo_url,status) VALUES (${id},${user.id},${period},${amount},${proofPhoto},'pending')`;
      for(const r of rentals){
        await sql`INSERT INTO commission_payment_rentals (commission_payment_id,rental_id) VALUES (${id},${r.id})`;
      }
      await sql`UPDATE rentals SET commission_pending=true,commission_payment_id=${id} WHERE id=ANY(${rentals.map(r=>r.id)})`;
      return json(res,201,{id,sellerId:user.id,period,rentalIds:rentals.map(r=>r.id),amount,proofPhoto,status:'pending',submittedAt:new Date().toISOString(),reviewedAt:null,reviewedBy:null,adminNote:'',manual:false});
    }
    if(req.method==='PATCH'){
      if(user.role!=='admin')return json(res,403,{error:'Admin access required.'});
      const {id,status,note=''}=req.body||{};
      if(typeof id!=='string'||!['verified','rejected'].includes(status))return json(res,400,{error:'A valid payment id and review status are required.'});
      const [cp]=await sql`SELECT id,status FROM commission_payments WHERE id=${id}`;
      if(!cp)return json(res,404,{error:'Commission payment not found.'});
      if(cp.status!=='pending')return json(res,409,{error:'This payment has already been reviewed.'});
      if(status==='rejected'&&!String(note).trim())return json(res,400,{error:'A rejection reason is required.'});
      await sql`UPDATE commission_payments SET status=${status},reviewed_at=now(),reviewed_by=${user.id},admin_note=${String(note).slice(0,1000)} WHERE id=${id}`;
      if(status==='verified')await sql`UPDATE rentals SET commission_paid=true,commission_pending=false,commission_paid_at=now() WHERE commission_payment_id=${id}`;
      else await sql`UPDATE rentals SET commission_pending=false,commission_payment_id=NULL WHERE commission_payment_id=${id}`;
      return json(res,200,{ok:true});
    }
    return methodNotAllowed(res,['GET','POST','PATCH']);
  }catch(error){return handleError(res,error);}
}
