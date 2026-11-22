import bcrypt from 'bcryptjs';
import { getDb, json, methodNotAllowed, handleError, currentUser } from '../db.js';

export default async function handler(req,res){
  if(req.method!=='POST')return methodNotAllowed(res,['POST']);
  try{
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    const {oldPassword,newPassword}=req.body||{};
    if(typeof oldPassword!=='string'||typeof newPassword!=='string'||newPassword.length<8||newPassword.length>72)return json(res,400,{error:'Current password and a new password (8–72 characters) are required.'});
    const [row]=await sql`SELECT password_hash FROM users WHERE id=${user.id}`;
    if(!row||!(await bcrypt.compare(oldPassword,row.password_hash)))return json(res,401,{error:'Current password is incorrect.'});
    const hash=await bcrypt.hash(newPassword,12);
    await sql`UPDATE users SET password_hash=${hash} WHERE id=${user.id}`;
    return json(res,200,{ok:true});
  }catch(error){return handleError(res,error);}
}
