const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

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
    apiKeyMonthlyUsageBudget: {
      type: Number,
      default: 500000, // Default 500,000 characters
    },
    apiKeyCurrentMonthUsage: {
      type: Number,
      default: 0,
    },
    apiKeyUsageResetDate: {
      type: Date,
      default: () => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        return d;
      },
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
  this.apiKeyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  this.apiKeyPrefix = rawKey.substring(0, 8); // "sk-ab12cd"
  await this.save();
  return rawKey;
};

// Verify an API key against this user's stored hash
userSchema.methods.verifyApiKey = async function (candidateKey) {
  if (!this.apiKeyHash) return false;
  // Fallback for older bcrypt hashed keys
  if (this.apiKeyHash.startsWith('$2a$') || this.apiKeyHash.startsWith('$2b$')) {
    return bcrypt.compare(candidateKey, this.apiKeyHash);
  }
  const hash = crypto.createHash('sha256').update(candidateKey).digest('hex');
  return hash === this.apiKeyHash;
};

// Check and reset the monthly usage budget if reset date has passed
userSchema.methods.checkAndResetUsageBudget = async function (apiKeyHash) {
  const now = new Date();
  if (this.apiKeyUsageResetDate && now >= this.apiKeyUsageResetDate) {
    this.apiKeyCurrentMonthUsage = 0;
    
    // Set reset date to 1st of next month
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    nextMonth.setHours(0, 0, 0, 0);
    this.apiKeyUsageResetDate = nextMonth;
    
    await this.save();

    // Sync to Redis cache if apiKeyHash is provided
    if (apiKeyHash) {
      const redisCache = require('../config/redis');
      if (redisCache.client && redisCache.client.status === 'ready') {
        const cacheKey = `apikey:${apiKeyHash}`;
        try {
          const plainUser = this.toObject();
          await redisCache.client.set(cacheKey, JSON.stringify(plainUser), 'EX', 300);
        } catch (err) {
          // ignore cache write error
        }
      }
    }
    return true;
  }
  return false;
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
