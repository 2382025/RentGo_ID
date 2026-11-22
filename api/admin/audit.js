import { randomBytes } from 'node:crypto';
import { getDb, json, methodNotAllowed, handleError, currentUser } from '../_lib/db.js';

export default async function handler(req,res){
  try{
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    if(user.role!=='admin')return json(res,403,{error:'Admin access required.'});
    if(req.method==='GET'){
      const logs=await sql`SELECT id,admin_id AS "adminId",admin_name AS "adminName",action,detail,created_at AS "createdAt" FROM audit_logs ORDER BY created_at DESC LIMIT 1000`;
      return json(res,200,{auditLogs:logs});
    }
    if(req.method==='POST'){
      const {action,detail=''}=req.body||{};
      if(typeof action!=='string'||!action.trim())return json(res,400,{error:'Audit action is required.'});
      const id=`log_${randomBytes(16).toString('hex')}`;
      const [log]=await sql`INSERT INTO audit_logs (id,admin_id,admin_name,action,detail) VALUES (${id},${user.id},${user.name},${action.slice(0,160)},${String(detail).slice(0,2000)}) RETURNING id,admin_id AS "adminId",admin_name AS "adminName",action,detail,created_at AS "createdAt"`;
      return json(res,201,{log});
    }
    return methodNotAllowed(res,['GET','POST']);
  }catch(error){return handleError(res,error);}
}
