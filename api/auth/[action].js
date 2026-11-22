import { json } from '../_lib/db.js';
import login from '../_lib/auth/login.js';
import logout from '../_lib/auth/logout.js';
import me from '../_lib/auth/me.js';
import password from '../_lib/auth/password.js';
import register from '../_lib/auth/register.js';

const handlers={login,logout,me,password,register};

export default function handler(req,res){
  const action=Array.isArray(req.query?.action)?req.query.action[0]:req.query?.action;
  const route=handlers[action];
  if(!route)return json(res,404,{error:'Unknown authentication endpoint.'});
  return route(req,res);
}
