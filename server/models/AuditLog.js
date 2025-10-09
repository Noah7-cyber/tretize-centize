// models/AuditLog.js
import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema({
  kind: { type:String, enum:['tracking_update','tracking_create','admin_note'], required:true },
  trackingId: { type:String, index:true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref:'User' },
  actorEmail: { type:String },
  actorName: { type:String },
  role: { type:String },
  changes: [{
    field: String,
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed
  }],
  note: { type:String }
}, { timestamps:true });

export default mongoose.model('AuditLog', AuditLogSchema);
