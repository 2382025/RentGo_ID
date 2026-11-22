import { randomBytes } from 'node:crypto';
import { getDb, json, methodNotAllowed, handleError, currentUser } from './_lib/db.js';

export default async function handler(req, res) {
  try {
    const sql = getDb();
    if (req.method === 'GET') {
      const rows = await sql`SELECT motors.id, seller_id AS "sellerId", users.name AS "sellerName", brand, motors.name, year, price_per_hour AS "pricePerHour", price_per_day AS "pricePerDay", location, location_detail AS "locationDetail", description, photo, helm_included AS "helmIncluded", helm_count AS "helmCount", is_open AS "isOpen", admin_blocked AS "adminBlocked", block_reason AS "blockReason", created_at AS "createdAt" FROM motors JOIN users ON users.id = motors.seller_id WHERE is_open = true AND is_deleted = false ORDER BY created_at DESC`;
      return json(res, 200, { motors: rows });
    }
    if (req.method === 'POST') {
      const user = await currentUser(req, sql);
      if (!user) return json(res, 401, { error: 'Sign in to add a listing.' });
      if (user.role !== 'seller') return json(res, 403, { error: 'Only seller accounts can add listings.' });
      const b = req.body || {};
      if (typeof b.brand !== 'string' || !b.brand.trim() || typeof b.name !== 'string' || !b.name.trim() ||
          !Number.isInteger(Number(b.year)) || Number(b.year) < 1990 || Number(b.year) > new Date().getFullYear() + 1 ||
          !Number.isFinite(Number(b.pricePerHour)) || Number(b.pricePerHour) <= 0 ||
          !Number.isFinite(Number(b.pricePerDay)) || Number(b.pricePerDay) <= 0 ||
          (typeof b.photo === 'string' && b.photo.length > 1_000_000)) {
        return json(res, 400, { error: 'Brand, model, valid year, and positive hourly and daily prices are required.' });
      }
      const id = randomBytes(16).toString('hex');
      const [motor] = await sql`INSERT INTO motors (id, seller_id, brand, name, year, price_per_hour, price_per_day, location, location_detail, description, photo, helm_included, helm_count) VALUES (${id}, ${user.id}, ${b.brand.trim()}, ${b.name.trim()}, ${Number(b.year)}, ${Number(b.pricePerHour)}, ${Number(b.pricePerDay)}, ${typeof b.location === 'string' ? b.location.slice(0, 160) : ''}, ${typeof b.locationDetail === 'string' ? b.locationDetail.slice(0, 300) : ''}, ${typeof b.description === 'string' ? b.description.slice(0, 2000) : ''}, ${typeof b.photo === 'string' ? b.photo : null}, ${Boolean(b.helmIncluded)}, ${Math.max(0, Math.min(10, Number(b.helmCount) || 0))}) RETURNING id, seller_id AS "sellerId", brand, name, year, price_per_hour AS "pricePerHour", price_per_day AS "pricePerDay", location, location_detail AS "locationDetail", description, photo, helm_included AS "helmIncluded", helm_count AS "helmCount", is_open AS "isOpen", created_at AS "createdAt"`;
      return json(res, 201, { motor });
    }
    if(req.method==='PUT'){
      const user=await currentUser(req,sql);
      if(!user)return json(res,401,{error:'Sign in to update a listing.'});
      const b=req.body||{};
      if(typeof b.id!=='string')return json(res,400,{error:'Motor id is required.'});
      if(user.role!=='seller'&&user.role!=='admin')return json(res,403,{error:'Seller access required.'});
      if(typeof b.brand!=='string'||!b.brand.trim()||typeof b.name!=='string'||!b.name.trim()||!Number.isInteger(Number(b.year))||!Number.isFinite(Number(b.pricePerHour))||Number(b.pricePerHour)<=0||!Number.isFinite(Number(b.pricePerDay))||Number(b.pricePerDay)<=0||(typeof b.photo==='string'&&b.photo.length>1_000_000))return json(res,400,{error:'Listing fields are invalid or its photo is too large.'});
      const [motor]=user.role==='admin'
        ? await sql`UPDATE motors SET brand=${b.brand.trim()},name=${b.name.trim()},year=${Number(b.year)},price_per_hour=${Number(b.pricePerHour)},price_per_day=${Number(b.pricePerDay)},location=${String(b.location||'').slice(0,160)},location_detail=${String(b.locationDetail||'').slice(0,300)},description=${String(b.description||'').slice(0,2000)},photo=${typeof b.photo==='string'?b.photo:null},helm_included=${Boolean(b.helmIncluded)},helm_count=${Math.max(0,Math.min(10,Number(b.helmCount)||0))} WHERE id=${b.id} RETURNING id,seller_id AS "sellerId",brand,name,year,price_per_hour AS "pricePerHour",price_per_day AS "pricePerDay",location,location_detail AS "locationDetail",description,photo,helm_included AS "helmIncluded",helm_count AS "helmCount",is_open AS "isOpen",admin_blocked AS "adminBlocked",block_reason AS "blockReason"`
        : await sql`UPDATE motors SET brand=${b.brand.trim()},name=${b.name.trim()},year=${Number(b.year)},price_per_hour=${Number(b.pricePerHour)},price_per_day=${Number(b.pricePerDay)},location=${String(b.location||'').slice(0,160)},location_detail=${String(b.locationDetail||'').slice(0,300)},description=${String(b.description||'').slice(0,2000)},photo=${typeof b.photo==='string'?b.photo:null},helm_included=${Boolean(b.helmIncluded)},helm_count=${Math.max(0,Math.min(10,Number(b.helmCount)||0))} WHERE id=${b.id} AND seller_id=${user.id} RETURNING id,seller_id AS "sellerId",brand,name,year,price_per_hour AS "pricePerHour",price_per_day AS "pricePerDay",location,location_detail AS "locationDetail",description,photo,helm_included AS "helmIncluded",helm_count AS "helmCount",is_open AS "isOpen",admin_blocked AS "adminBlocked",block_reason AS "blockReason"`;
      return motor?json(res,200,{motor}):json(res,404,{error:'Listing not found or not owned by this account.'});
    }
    if(req.method==='PATCH'){
      const user=await currentUser(req,sql);
      if(!user)return json(res,401,{error:'Sign in required.'});
      const {id,isOpen,adminBlocked,blockReason}=req.body||{};
      if(typeof id!=='string')return json(res,400,{error:'Motor id is required.'});
      let rows;
      if(user.role==='admin'&&typeof adminBlocked==='boolean')rows=await sql`UPDATE motors SET admin_blocked=${adminBlocked},block_reason=${String(blockReason||'').slice(0,500)} WHERE id=${id} RETURNING id,is_open AS "isOpen",admin_blocked AS "adminBlocked",block_reason AS "blockReason"`;
      else if(user.role==='seller'&&typeof isOpen==='boolean')rows=await sql`UPDATE motors SET is_open=${isOpen} WHERE id=${id} AND seller_id=${user.id} RETURNING id,is_open AS "isOpen"`;
      else return json(res,403,{error:'Not allowed to change this listing.'});
      return rows[0]?json(res,200,{motor:rows[0]}):json(res,404,{error:'Listing not found.'});
    }
    if(req.method==='DELETE'){
      const user=await currentUser(req,sql);
      if(!user)return json(res,401,{error:'Sign in required.'});
      const id=req.body?.id;
      if(typeof id!=='string')return json(res,400,{error:'Motor id is required.'});
      const rows=user.role==='admin'?await sql`UPDATE motors SET is_deleted=true,is_open=false WHERE id=${id} RETURNING id`:user.role==='seller'?await sql`UPDATE motors SET is_deleted=true,is_open=false WHERE id=${id} AND seller_id=${user.id} RETURNING id`:[];
      return rows[0]?json(res,200,{ok:true}):json(res,404,{error:'Listing not found or not owned by this account.'});
    }
    return methodNotAllowed(res, ['GET', 'POST','PUT','PATCH','DELETE']);
  } catch (error) {
    return handleError(res, error);
  }
}
