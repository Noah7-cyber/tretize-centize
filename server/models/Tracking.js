import mongoose from 'mongoose';

const CheckpointSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    text: { type: String, required: true },
    icon: { type: String, enum: ['label', 'pickup', 'transit', 'out', 'done'], default: 'transit' }
  },
  { _id: false }
);

const TrackingSchema = new mongoose.Schema({
  trackingId: { type: String, required: true, unique: true, index: true },
  sender:     { type: String },
  receiver:   { type: String },
  phone:      { type: String },
  origin:     { type: String },
  destination:{ type: String },
  cargo:      { type: String },
  count: { type: Number, default: 1 },
  shipmentType: { type: String, trim: true },
  weight:     { type: String },
  vehicle:    { type: String },
  driver:     { type: String },
  checkpoints:{ type: [CheckpointSchema], default: [] }
}, { timestamps: true });
export default mongoose.model('Tracking', TrackingSchema);
