import { randomBytes } from 'node:crypto';
import { getDb, json, methodNotAllowed, handleError, currentUser } from './_lib/db.js';

export default async function handler(req,res){
  try{
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    if(req.method==='GET'){
      const {rentalId}=req.query||{};
      if(!rentalId)return json(res,400,{error:'Rental id is required.'});
      const [r]=await sql`SELECT buyer_id,seller_id FROM rentals WHERE id=${rentalId}`;
      if(!r)return json(res,404,{error:'Rental not found.'});
      if(user.role!=='admin'&&user.id!==r.buyer_id&&user.id!==r.seller_id)return json(res,403,{error:'Not a participant in this chat.'});
      const rows=await sql`SELECT id,rental_id AS "rentalId",sender_id AS "senderId",receiver_id AS "receiverId",message_text AS text,photo_url AS photo,is_read AS read,created_at AS "createdAt" FROM chat_messages WHERE rental_id=${rentalId} ORDER BY created_at`;
      await sql`UPDATE chat_messages SET is_read=true WHERE rental_id=${rentalId} AND receiver_id=${user.id}`;
      return json(res,200,{messages:rows});
    }
    if(req.method==='POST'){
      const {rentalId,text='',photo=null}=req.body||{};
      if(typeof rentalId!=='string'||typeof text!=='string'||text.length>4000||(photo!==null&&(typeof photo!=='string'||photo.length>1_000_000))||(!text.trim()&&!photo))return json(res,400,{error:'Message text or a photo up to 1 MB is required.'});
      const [r]=await sql`SELECT buyer_id,seller_id,status FROM rentals WHERE id=${rentalId}`;
      if(!r||![r.buyer_id,r.seller_id].includes(user.id)||!['booked','active','completed'].includes(r.status))return json(res,403,{error:'Chat is available to rental participants.'});
      const receiverId=user.id===r.buyer_id?r.seller_id:r.buyer_id;
      const id=`c_${randomBytes(16).toString('hex')}`;
      const [message]=await sql`INSERT INTO chat_messages (id,rental_id,sender_id,receiver_id,message_text,photo_url) VALUES (${id},${rentalId},${user.id},${receiverId},${text},${photo}) RETURNING id,rental_id AS "rentalId",sender_id AS "senderId",receiver_id AS "receiverId",message_text AS text,photo_url AS photo,is_read AS read,created_at AS "createdAt"`;
      return json(res,201,{message});
    }
    if(req.method==='PATCH'){
      const {rentalId}=req.body||{};
      if(!rentalId)return json(res,400,{error:'Rental id is required.'});
      await sql`UPDATE chat_messages SET is_read=true WHERE rental_id=${rentalId} AND receiver_id=${user.id}`;
      return json(res,200,{ok:true});
    }
    return methodNotAllowed(res,['GET','POST','PATCH']);
  }catch(error){return handleError(res,error);}
}
