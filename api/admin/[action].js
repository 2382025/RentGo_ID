import { json } from '../_lib/db.js';
import audit from '../_lib/admin/audit.js';
import importLegacy from '../_lib/admin/import-legacy.js';
import reset from '../_lib/admin/reset.js';
import settings from '../_lib/admin/settings.js';

const handlers={audit,'import-legacy':importLegacy,reset,settings};

export default function handler(req,res){
  const action=Array.isArray(req.query?.action)?req.query.action[0]:req.query?.action;
  const route=handlers[action];
  if(!route)return json(res,404,{error:'Unknown admin endpoint.'});
  return route(req,res);
}
