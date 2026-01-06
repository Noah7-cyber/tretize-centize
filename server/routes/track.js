// server/routes/track.js
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { buildTransport, getFromAddress } from '../services/mailer.js';
import Tracking from '../models/Tracking.js';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import { requireAuth, requireAnyRole } from '../middleware/auth.js';
import { Parser as Json2Csv } from 'json2csv';

function editableFields(role){
  if (role === 'admin' || role === 'it') return ['sender','receiver','phone','origin','destination','cargo','weight','vehicle','driver','count','shipmentType'];
  if (role === 'ops' || role === 'dispatch' || role === 'warehouse') return ['vehicle','driver','weight','destination','phone'];
  return [];
}
function genId(){
  const rand = nanoid(6).toUpperCase();
  const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
  return `TRZ-${date}-${rand}`;
}

// create 2 routers
const publicRouter = Router();
const secureRouter = Router();

/* --------------------------------------------------
   PUBLIC ROUTES  (no authentication required)
   -------------------------------------------------- */

/* --------------------------------------------------
   PUBLIC ROUTES  (no authentication required)
   -------------------------------------------------- */

// list first
publicRouter.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();

    const match = {};
    if (q) {
      match.$or = [
        { trackingId: new RegExp(q, 'i') },
        { origin: new RegExp(q, 'i') },
        { destination: new RegExp(q, 'i') },
        { driver: new RegExp(q, 'i') },
        { vehicle: new RegExp(q, 'i') },
      ];
    }

    const pipeline = [
      { $match: match },
      { $addFields: { lastIndex: { $subtract: [ { $size: { $ifNull: ['$checkpoints', []] } }, 1 ] } } },
      { $addFields: {
          lastStatus: { $cond:[{ $gte:['$lastIndex',0] },{ $arrayElemAt:['$checkpoints.icon','$lastIndex'] },null] },
          lastStatusAt: { $cond:[{ $gte:['$lastIndex',0] },{ $arrayElemAt:['$checkpoints.at','$lastIndex'] },null] }
      }},
      ...(status ? [ { $match: { lastStatus: status } } ] : []),
      { $project:{ _id:0,trackingId:1,origin:1,destination:1,driver:1,vehicle:1,updatedAt:1,lastStatus:1,lastStatusAt:1 } },
      { $sort:{ updatedAt:-1 } },
      { $limit:limit },
    ];

    const docs = await Tracking.aggregate(pipeline);
    res.json({ ok:true, data:docs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false });
  }
});

// move seed/export ABOVE the :id route
publicRouter.post('/seed', async (_req,res)=>{
  const now=new Date();const mins=m=>new Date(now.getTime()+m*60000);
  const demo={trackingId:'DEMO123',checkpoints:[
    {at:mins(-220),text:'Label created',icon:'label'},
    {at:mins(-180),text:'Picked up',icon:'pickup'},
    {at:mins(-60),text:'In transit',icon:'transit'},
    {at:mins(-20),text:'Out for delivery',icon:'out'},
    {at:mins(0),text:'Delivered',icon:'done'}
  ]};
  await Tracking.findOneAndUpdate({trackingId:demo.trackingId},demo,{upsert:true});
  res.json({ok:true,id:demo.trackingId});
});

publicRouter.get('/export/all', async (req,res)=>{
  try{
    const rows=await Tracking.find().lean();
    const fields=['trackingId','origin','destination','sender','receiver','cargo','weight','driver','vehicle','count','shipmentType','createdAt','updatedAt'];
    const parser=new Json2Csv({fields});
    const csv=parser.parse(rows||[]);
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="shipments.csv"');
    res.status(200).send(csv);
  }catch(e){res.status(500).json({ok:false,message:'export failed'});}
});

// finally, the per-ID route (case-insensitive)
publicRouter.get('/:id', async (req,res)=>{
  try{
    const trackingId = String(req.params.id||'').trim();
    // make it case-insensitive
    const doc = await Tracking.findOne({ trackingId: new RegExp(`^${trackingId}$`, 'i') });
    if(!doc) return res.json({ ok:false });
    const data = {
      trackingId:doc.trackingId,
      sender:doc.sender,receiver:doc.receiver,phone:doc.phone,
      origin:doc.origin,destination:doc.destination,
      cargo:doc.cargo,weight:doc.weight,vehicle:doc.vehicle,driver:doc.driver,
      checkpoints:doc.checkpoints||[]
    };
    res.json({ ok:true,data });
  }catch(e){
    console.error(e);
    res.status(500).json({ ok:false });
  }
});


/* --------------------------------------------------
   SECURE ROUTES  (authentication required)
   -------------------------------------------------- */
secureRouter.use(requireAuth);

secureRouter.post('/', async (req,res)=>{
  try{
    const id=genId();
    const doc=await Tracking.create({
      trackingId:id,
      sender:req.body.sender,receiver:req.body.receiver,phone:req.body.phone,
      origin:req.body.origin,destination:req.body.destination,
      cargo:req.body.cargo,weight:req.body.weight,
      vehicle:req.body.vehicle,driver:req.body.driver,
      count:Number(req.body.count)||1,
      shipmentType:req.body.shipmentType||'standard',
      checkpoints:[{at:new Date(),text:'Label created',icon:'label'}]
    });
    res.json({ok:true,id:doc.trackingId});
  }catch(e){console.error(e);res.status(500).json({ok:false});}
});

secureRouter.post('/:id/checkpoints', async (req,res)=>{
  try{
    const trackingId=req.params.id.trim();
    const {at,text,icon,location}=req.body||{};
    const ALLOWED=['label','pickup','transit','out','done'];
    if(!ALLOWED.includes(icon)) return res.status(400).json({ok:false,message:'invalid status'});
    const payload={at:at?new Date(at):new Date(),text:String(text||icon),icon};
    if(location) payload.text+=` — ${location}`;
    const doc=await Tracking.findOneAndUpdate({trackingId},{ $push:{checkpoints:payload}}, {new:true});
    res.json({ok:true,data:{trackingId:doc.trackingId,checkpoints:doc.checkpoints||[]}});
  }catch(e){console.error(e);res.status(500).json({ok:false});}
});

secureRouter.put('/:id', async (req,res)=>{
  try{
    const trackingId=req.params.id.trim();
    const doc=await Tracking.findOne({trackingId});
    if(!doc) return res.status(404).json({ok:false});
    const allowed=new Set(editableFields(req.user.role));
    if(!allowed.size) return res.status(403).json({ok:false});
    const incoming=req.body||{};
    const changes=[];const editablePayload={};
    for(const k of Object.keys(incoming)){
      if(allowed.has(k)){
        const before=doc[k],after=incoming[k];
        if(String(before??'')!==String(after??'')){
          editablePayload[k]=after;
          changes.push({field:k,before,after});
        }
      }
    }
    Object.assign(doc,editablePayload);await doc.save();
    if(changes.length){
      await AuditLog.create({kind:'tracking_update',trackingId,actorId:req.user._id,actorEmail:req.user.email,actorName:req.user.displayName||'',role:req.user.role,changes});
    }
    res.json({ok:true,data:doc});
  }catch(e){console.error(e);res.status(500).json({ok:false});}
});

secureRouter.get('/:id/audit', async (req,res)=>{
  try{
    const trackingId=req.params.id.trim();
    const rows=await AuditLog.find({trackingId}).sort({createdAt:-1}).limit(100).lean();
    res.json({ok:true,data:rows});
  }catch(e){console.error(e);res.status(500).json({ok:false});}
});

secureRouter.post('/:id/admin-note', requireAnyRole('admin','it'), async (req,res)=>{
  try{
    const trackingId=req.params.id.trim();
    const {toEmail,note}=req.body||{};
    if(!note) return res.status(400).json({ok:false,message:'note required'});
    await AuditLog.create({kind:'admin_note',trackingId,actorId:req.user._id,actorEmail:req.user.email,actorName:req.user.displayName||'',role:req.user.role,note});
    if(toEmail){
      const t=buildTransport();
      await t.sendMail({from:getFromAddress(),to:toEmail,subject:`Correction on ${trackingId}`,text:note});
    }
    res.json({ok:true});
  }catch(e){console.error(e);res.status(500).json({ok:false});}
});

export default { public: publicRouter, secure: secureRouter };
