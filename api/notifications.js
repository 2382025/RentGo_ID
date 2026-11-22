import { randomBytes } from 'node:crypto';
import { getDb, json, methodNotAllowed, handleError, currentUser } from './_lib/db.js';

export default async function handler(req,res){
  try{
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    if(req.method==='GET'){
      const rows=await sql`SELECT id,user_id AS "userId",notification_type AS type,title,message,rental_id AS "rentalId",link,is_read AS read,created_at AS "createdAt" FROM notifications WHERE user_id=${user.id} ORDER BY created_at DESC LIMIT 500`;
      return json(res,200,{notifications:rows});
    }
    if(req.method==='PATCH'){
      const {id,all=false}=req.body||{};
      if(all)await sql`UPDATE notifications SET is_read=true WHERE user_id=${user.id}`;
      else if(typeof id==='string')await sql`UPDATE notifications SET is_read=true WHERE id=${id} AND user_id=${user.id}`;
      else return json(res,400,{error:'Notification id is required.'});
      return json(res,200,{ok:true});
    }
    if(req.method==='POST'){
      const {userId,type,title,message,rentalId=null,link=null}=req.body||{};
      if(user.role!=='admin'){
        if(!rentalId)return json(res,403,{error:'Only admins can send general notifications.'});
        const [r]=await sql`SELECT buyer_id,seller_id FROM rentals WHERE id=${rentalId}`;
        if(!r||![r.buyer_id,r.seller_id].includes(user.id)||![r.buyer_id,r.seller_id].includes(userId)||user.id===userId)return json(res,403,{error:'Notification recipient must be the other rental participant.'});
      }
      if(typeof userId!=='string'||typeof title!=='string'||typeof message!=='string')return json(res,400,{error:'Recipient, title, and message are required.'});
      const id=`n_${randomBytes(16).toString('hex')}`;
      const [notification]=await sql`INSERT INTO notifications (id,user_id,notification_type,title,message,rental_id,link) VALUES (${id},${userId},${String(type||'info').slice(0,40)},${title.slice(0,120)},${message.slice(0,1000)},${rentalId},${typeof link==='string'?link.slice(0,300):null}) RETURNING id,user_id AS "userId",notification_type AS type,title,message,rental_id AS "rentalId",link,is_read AS read,created_at AS "createdAt"`;
      return json(res,201,{notification});
    }
    return methodNotAllowed(res,['GET','POST','PATCH']);
  }catch(error){return handleError(res,error);}
}
