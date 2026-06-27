const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Never returned in queries by default
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    apiKey: {
      type: String,
      unique: true,
      sparse: true,
      select: false, // Hidden by default; only shown on explicit select
    },
    apiKeyHash: {
      type: String,
      select: false,
    },
    apiKeyPrefix: {
      type: String, // e.g. "sk-abc1" — shown in listings so users identify their key
    },
    apiKeyScopes: {
      type: [String],
      default: ['predict:v1', 'predict:v2', 'predict:batch', 'history:read'],
    },
    apiKeyRateLimit: {
      type: Number,
      default: 100,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: Date,
    requestCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes (email has unique:true on the field definition — no duplicate index needed)
userSchema.index({ apiKeyPrefix: 1 });

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare plain password to hash
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Generate a new API key — returns the plain key (store it, it won't be retrievable again)
userSchema.methods.generateApiKey = async function () {
  const rawKey = `sk-${uuidv4().replace(/-/g, '')}`;
  this.apiKeyHash = await bcrypt.hash(rawKey, 10);
  this.apiKeyPrefix = rawKey.substring(0, 8); // "sk-ab12cd"
  await this.save();
  return rawKey;
};

// Verify an API key against this user's stored hash
userSchema.methods.verifyApiKey = async function (candidateKey) {
  if (!this.apiKeyHash) return false;
  return bcrypt.compare(candidateKey, this.apiKeyHash);
};

// Strip sensitive fields from JSON output
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.apiKey;
  delete obj.apiKeyHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
