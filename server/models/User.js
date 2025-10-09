// models/User.js
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  email:   { type:String, required:true, unique:true, index:true },
  role:    { type:String, enum: ['it','ops','finance','admin','driver','warehouse','dispatch'], default:'ops' },
  displayName: { type:String, default:'' },       // 👈 NEW
  passwordHash: { type:String, required:true },
  forcePasswordChange: { type:Boolean, default:true },
  active:  { type:Boolean, default:true },
  lastSeenAt: { type: Date }                      // 👈 NEW
}, { timestamps:true });

export default mongoose.model('User', UserSchema);
