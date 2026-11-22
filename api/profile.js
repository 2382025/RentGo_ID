import { getDb, json, methodNotAllowed, handleError, currentUser } from './_lib/db.js';

export default async function handler(req,res){
  try{
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    if(req.method==='GET'){
      const [u]=await sql`SELECT id,name,email,role,phone,balance,bank_name AS "bankName",account_number AS "accountNumber",account_holder AS "accountHolder",photo_url AS photo,qris_photo_url AS "qrisPhoto",suspended,suspend_reason AS "suspendReason" FROM users WHERE id=${user.id}`;
      return json(res,200,{user:u});
    }
    if(req.method==='PATCH'){
      const b=req.body||{};
      const photoFields=['photo','qrisPhoto'];
      for(const k of photoFields)if(b[k]!=null&&(typeof b[k]!=='string'||b[k].length>1_000_000))return json(res,400,{error:'Photo size must be 1 MB or less.'});
      const [u]=await sql`UPDATE users SET name=${typeof b.name==='string'?b.name.slice(0,100):user.name}, phone=${typeof b.phone==='string'?b.phone.slice(0,40):user.phone||''}, bank_name=${typeof b.bankName==='string'?b.bankName.slice(0,80):user.bankName}, account_number=${typeof b.accountNumber==='string'?b.accountNumber.slice(0,80):user.accountNumber}, account_holder=${typeof b.accountHolder==='string'?b.accountHolder.slice(0,100):user.accountHolder}, photo_url=${b.photo===null?null:typeof b.photo==='string'?b.photo:user.photo}, qris_photo_url=${b.qrisPhoto===null?null:typeof b.qrisPhoto==='string'?b.qrisPhoto:user.qrisPhoto} WHERE id=${user.id} RETURNING id,name,email,role,phone,balance,bank_name AS "bankName",account_number AS "accountNumber",account_holder AS "accountHolder",photo_url AS photo,qris_photo_url AS "qrisPhoto"`;
      return json(res,200,{user:u});
    }
    return methodNotAllowed(res,['GET','PATCH']);
  }catch(error){return handleError(res,error);}
}
