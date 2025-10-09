import mongoose from 'mongoose';

const QuoteSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    origin: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    details: { type: String, default: '' },
    consent: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model('Quote', QuoteSchema);
