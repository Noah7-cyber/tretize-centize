// server/routes/track.js
import { Router } from 'express';
import { buildTransport, getFromAddress } from '../services/mailer.js';
import Tracking from '../models/Tracking.js';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import { requireAuth, requireRole,requireAnyRole  } from '../middleware/auth.js';

import { Parser as Json2Csv } from 'json2csv';
const router = Router();
// utils
function editableFields(role){
  if (role === 'admin' || role === 'it') return ['sender','receiver','phone','origin','destination','cargo','weight','vehicle','driver','count','shipmentType'];
  // Ops can fix operational details only:
  if (role === 'ops' || role === 'dispatch' || role === 'warehouse') return ['vehicle','driver','weight','destination','phone'];
  // Others: read-only by default
  return [];
}
function genId(){
  const rand = Math.random().toString(36).substring(2,6).toUpperCase();
  const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
  return `TRZ-${date}-${rand}`;
}
router.get('/export', async (req, res) => {
  try {
    const rows = await Tracking.find().lean();// adjust model name
    const fields = [
      'trackingId','origin','destination','sender','receiver',
      'cargo','weight','driver','vehicle',
      'count','shipmentType','createdAt','updatedAt'
    ];
    const parser = new Json2Csv({ fields });
    const csv = parser.parse(rows || []);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="shipments.csv"');
    return res.status(200).send(csv);
  } catch (e) {
    return res.status(500).json({ ok:false, message:'export failed' });
  }
});

// GET /api/track/:id  (already present)
router.get('/:id', async (req, res) => {
  try {
    const trackingId = String(req.params.id || '').trim();
    if (!trackingId) return res.json({ ok: false });

    const doc = await Tracking.findOne({ trackingId });
    if (!doc) return res.json({ ok: false });

    const data = {
      trackingId: doc.trackingId,
      sender: doc.sender, receiver: doc.receiver, phone: doc.phone,
      origin: doc.origin, destination: doc.destination,
      cargo: doc.cargo, weight: doc.weight,
      vehicle: doc.vehicle, driver: doc.driver,
      checkpoints: doc.checkpoints || [],
      lastCheckpointAt: doc.checkpoints?.length
        ? doc.checkpoints.map(c=>new Date(c.at)).sort((a,b)=>b-a)[0]
        : null
    };
    const now = Date.now();
    const stale = data.lastCheckpointAt
      ? (now - new Date(data.lastCheckpointAt).getTime()) >= (24*60*60*1000)
      : true;

    return res.json({ ok: true, data, stale });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false });
  }
});


// NEW: POST /api/track  -> create a new trackingId
// Create shipment

// server/routes/track.js
router.post('/', requireAuth, async (req, res) => {
  try {
    const id = genId();
    const doc = await Tracking.create({
      trackingId: id,
      sender: req.body.sender,
      receiver: req.body.receiver,
      phone: req.body.phone,
      origin: req.body.origin,
      destination: req.body.destination,
      cargo: req.body.cargo,
      weight: req.body.weight,
      vehicle: req.body.vehicle,
      driver: req.body.driver,
      count: Number(req.body.count) || 1,
      shipmentType: req.body.shipmentType || 'standard',
      checkpoints: [{ at:new Date(), text:'Label created', icon:'label' }]
    });

    return res.json({ ok:true, id: doc.trackingId });
  } catch (err){
    console.error(err);
    return res.status(500).json({ ok:false, message:'server error' });
  }
});

// NEW: POST /api/track/:id/checkpoints  -> append a checkpoint
router.post('/:id/checkpoints',requireAuth, async (req, res) => {
  try {
    const trackingId = String(req.params.id || '').trim();
    const { at, text, icon, location } = req.body || {};
    if (!trackingId) return res.status(400).json({ ok:false, message:'id required' });

    // validate icon against model enum
    const ALLOWED = ['label','pickup','transit','out','done']; // same as schema :contentReference[oaicite:5]{index=5}
    if (!ALLOWED.includes(icon)) return res.status(400).json({ ok:false, message:'invalid status' });

    const payload = {
      at: at ? new Date(at) : new Date(),
      text: String(text || '').trim() || icon,
      icon,
    };
    if (location) payload.text += ` — ${String(location).trim()}`;

    const doc = await Tracking.findOneAndUpdate(
      { trackingId },
      { $push: { checkpoints: payload } },
      { new: true, upsert: true }
    );

    return res.json({ ok:true, data:{ trackingId: doc.trackingId, checkpoints: doc.checkpoints || [] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false, message:'server error' });
  }
});
// PUT /api/track/:id  — role-based edits
router.put('/:id', requireAuth, async (req,res)=>{
  try{
    const trackingId = String(req.params.id||'').trim();
    if(!trackingId) return res.status(400).json({ ok:false, message:'id required' });

    const doc = await Tracking.findOne({ trackingId });
    if(!doc) return res.status(404).json({ ok:false, message:'not found' });

    const allowed = new Set(editableFields(req.user.role));
    if (!allowed.size) return res.status(403).json({ ok:false, message:'not allowed' });

    const incoming = req.body || {};
    const changes = [];
    const editablePayload = {};

    for (const k of Object.keys(incoming)){
      if (allowed.has(k)){
        const before = doc[k];
        const after = incoming[k];
        if (String(before ?? '') !== String(after ?? '')){
          editablePayload[k] = after;
          changes.push({ field:k, before, after });
        }
      }
    }

    if (!changes.length) return res.json({ ok:true, data: doc });

    Object.assign(doc, editablePayload);
    await doc.save();

    await AuditLog.create({
      kind:'tracking_update',
      trackingId,
      actorId: req.user._id,
      actorEmail: req.user.email,
      actorName: req.user.displayName || '',
      role: req.user.role,
      changes
    });

    return res.json({ ok:true, data: doc });
  }catch(e){
    console.error(e);
    return res.status(500).json({ ok:false });
  }
});

// GET /api/track/:id/audit — recent audit
router.get('/:id/audit', requireAuth, async (req,res)=>{
  try{
    const trackingId = String(req.params.id||'').trim();
    const rows = await AuditLog.find({ trackingId }).sort({ createdAt:-1 }).limit(100).lean();
    return res.json({ ok:true, data: rows });
  }catch(e){
    console.error(e);
    return res.status(500).json({ ok:false });
  }
});

// POST /api/track/:id/admin-note — admin leaves a note + optional email
router.post('/:id/admin-note', requireAuth, requireAnyRole('admin','it'), async (req,res)=>{
  try{
    const trackingId = String(req.params.id||'').trim();
    const { toEmail, note } = req.body || {};
    if (!note) return res.status(400).json({ ok:false, message:'note required' });

    await AuditLog.create({
      kind:'admin_note', trackingId,
      actorId: req.user._id, actorEmail: req.user.email, actorName: req.user.displayName || '', role: req.user.role,
      note
    });

    if (toEmail){
      const t = buildTransport();
      await t.sendMail({
        from: getFromAddress(),
        to: toEmail,
        subject: `Correction on ${trackingId}`,
        text: note
      });
    }
    return res.json({ ok:true });
  }catch(e){
    console.error(e);
    return res.status(500).json({ ok:false });
  }
});

// (Optional) seed demo remains available
router.post('/seed', async (_req, res) => {
  const now = new Date();
  const mins = m => new Date(now.getTime() + m * 60000);
  const demo = {
    trackingId: 'DEMO123',
    checkpoints: [
      { at: mins(-220), text: 'Label created',       icon: 'label'   },
      { at: mins(-180), text: 'Picked up at origin', icon: 'pickup'  },
      { at: mins(-60),  text: 'In transit',          icon: 'transit' },
      { at: mins(-20),  text: 'Out for delivery',    icon: 'out'     },
      { at: mins(0),    text: 'Delivered',           icon: 'done'    }
    ]
  };
  await Tracking.findOneAndUpdate({ trackingId: demo.trackingId }, demo, { upsert: true });
  res.json({ ok: true, id: demo.trackingId });
});
router.put('/:id/label', async (req,res)=>{
  const trackingId = String(req.params.id||'').trim();
  const { text, at } = req.body || {};
  if(!trackingId || !text) return res.status(400).json({ ok:false, message:'text required' });
  const doc = await Tracking.findOne({ trackingId });
  if(!doc) return res.status(404).json({ ok:false });
  // find first 'label' checkpoint
  const i = (doc.checkpoints||[]).findIndex(c => c.icon==='label');
  const payload = { at: at?new Date(at):new Date(), text:String(text), icon:'label' };
  if(i>=0) doc.checkpoints[i] = payload; else doc.checkpoints.unshift(payload);
  await doc.save();
  res.json({ ok:true, data:{ trackingId:doc.trackingId, checkpoints:doc.checkpoints } });
});
// server/routes/track.js
// server/routes/track.js
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const q = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim(); // 'label' | 'pickup' | ...

    const match = {};
    // text-ish search over common fields (case-insensitive)
    if (q) {
      match.$or = [
        { trackingId: new RegExp(q, 'i') },
        { origin:     new RegExp(q, 'i') },
        { destination:new RegExp(q, 'i') },
        { driver:     new RegExp(q, 'i') },
        { vehicle:    new RegExp(q, 'i') },
      ];
    }

    const pipeline = [
      { $match: match },
      // compute lastStatus / lastStatusAt from checkpoints array
      {
        $addFields: {
          lastIndex: { $subtract: [ { $size: { $ifNull: ['$checkpoints', []] } }, 1 ] },
        }
      },
      {
        $addFields: {
          lastStatus: {
            $cond: [
              { $gte: ['$lastIndex', 0] },
              { $arrayElemAt: ['$checkpoints.icon', '$lastIndex'] },
              null
            ]
          },
          lastStatusAt: {
            $cond: [
              { $gte: ['$lastIndex', 0] },
              { $arrayElemAt: ['$checkpoints.at', '$lastIndex'] },
              null
            ]
          }
        }
      },
      ...(status ? [ { $match: { lastStatus: status } } ] : []),
      {
        $project: {
          _id: 0,
          trackingId: 1,
          origin: 1,
          destination: 1,
          driver: 1,
          vehicle: 1,
          updatedAt: 1,
          lastStatus: 1,
          lastStatusAt: 1,
        }
      },
      { $sort: { updatedAt: -1 } },
      { $limit: limit },
    ];

    const docs = await Tracking.aggregate(pipeline);
    res.json({ ok: true, data: docs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

router.post('/:id/nudge', async (req, res)=>{
  try{
    const trackingId = String(req.params.id||'').trim();
    const doc = await Tracking.findOne({ trackingId });
    if(!doc) return res.status(404).json({ ok:false });

    const lastCp = (doc.checkpoints||[]).reduce((m,c)=> !m || c.at>m ? c.at : m, null);
    const lastAt = lastCp ? new Date(lastCp).getTime() : 0;
    const now = Date.now();
    const day = 24*60*60*1000;

    // Only valid if >= 1 day since last worker update
    if(now - lastAt < day) return res.json({ ok:false, reason:'too_soon' });

    // Optional: also throttle pings (e.g., one per 6h)
    const lastPing = doc.lastClientPingAt ? new Date(doc.lastClientPingAt).getTime() : 0;
    if(now - lastPing < (6*60*60*1000)) return res.json({ ok:false, reason:'recent_ping' });

    const to = process.env.WORKERS_INBOX || process.env.MAIN_INBOX; // fallback to your inbox config
    const transporter = buildTransport();
    await transporter.sendMail({
      from: getFromAddress(),
      to,
      subject: `Client ping on ${trackingId} — update requested`,
      text: `A client viewed tracking ${trackingId} and there has been no update for at least 24 hours.\n\nRoute: ${doc.origin||'?'} → ${doc.destination||'?'}\nDriver/Vehicle: ${doc.driver||'-'} / ${doc.vehicle||'-'}\n\nPlease update the shipment if appropriate.`
    });

    doc.lastClientPingAt = new Date();
    await doc.save();
    res.json({ ok:true });
  }catch(e){
    console.error(e);
    res.status(500).json({ ok:false });
  }
});
export default router;


