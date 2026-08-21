import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import ImageKit from 'imagekit';
import { createServer as createViteServer } from 'vite';
import { initialCategories, initialHeroSlides, initialSiteSettings } from './src/data/initialData.ts';
import { AppDataStore } from './src/types.ts';

dotenv.config();

const currentDirname = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

const PORT = 3000;
const PERSISTENT_DIR = process.env.PERSISTENT_DATA_DIR || path.join(process.cwd(), '.data_storage');
const BACKUPS_DIR = path.join(PERSISTENT_DIR, 'backups');
const STORE_FILE = path.join(PERSISTENT_DIR, 'store.json');
const FALLBACK_REPO_STORE = path.join(process.cwd(), 'data', 'store.json');

// Ensure data and backup directories exist
[PERSISTENT_DIR, BACKUPS_DIR, path.dirname(FALLBACK_REPO_STORE)].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Clean old backups to prevent infinite storage growth
function cleanOldBackups() {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) return;
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter((f) => f.startsWith('store_backup_') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length > 30) {
      files.slice(30).forEach((f) => {
        try {
          fs.unlinkSync(path.join(BACKUPS_DIR, f));
        } catch (e) {
          // ignore unlink error
        }
      });
    }
  } catch (err) {
    console.error('Error cleaning old backups:', err);
  }
}

// Save store payload with automatic backup creation
function saveStore(store: AppDataStore, isAutoBackup = true): boolean {
  try {
    store.initialized = true;
    store.lastBackupAt = new Date().toISOString();
    const payload = JSON.stringify(store, null, 2);

    // Save to primary persistent storage
    fs.writeFileSync(STORE_FILE, payload, 'utf-8');

    // Sync to secondary repo storage if present
    try {
      fs.writeFileSync(FALLBACK_REPO_STORE, payload, 'utf-8');
    } catch (e) {
      // ignore mirror error
    }

    // Auto backup creation
    if (isAutoBackup) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(BACKUPS_DIR, `store_backup_${timestamp}.json`);
      const latestPath = path.join(BACKUPS_DIR, `latest_backup.json`);

      fs.writeFileSync(backupPath, payload, 'utf-8');
      fs.writeFileSync(latestPath, payload, 'utf-8');

      cleanOldBackups();
    }

    return true;
  } catch (err) {
    console.error('Error saving store.json:', err);
    return false;
  }
}

// Load store data with strict array preservation
function loadStore(): AppDataStore {
  let activeFile = STORE_FILE;
  if (!fs.existsSync(activeFile) && fs.existsSync(FALLBACK_REPO_STORE)) {
    activeFile = FALLBACK_REPO_STORE;
  }

  if (fs.existsSync(activeFile)) {
    try {
      const raw = fs.readFileSync(activeFile, 'utf-8');
      const data = JSON.parse(raw);

      const store: AppDataStore = {
        products: Array.isArray(data.products) ? data.products : [],
        categories: Array.isArray(data.categories) && data.categories.length > 0 ? data.categories : initialCategories,
        heroSlides: Array.isArray(data.heroSlides) && data.heroSlides.length > 0 ? data.heroSlides : initialHeroSlides,
        settings: data.settings || initialSiteSettings,
        orders: Array.isArray(data.orders) ? data.orders : [],
        pageViews: typeof data.pageViews === 'number' ? data.pageViews : 100,
        initialized: true,
        lastBackupAt: data.lastBackupAt || new Date().toISOString(),
      };

      return store;
    } catch (err) {
      console.error('Error reading store file, creating empty structure:', err);
    }
  }

  // First-time database initialization: Strictly EMPTY products array!
  const initialStore: AppDataStore = {
    products: [],
    categories: initialCategories,
    heroSlides: initialHeroSlides,
    settings: initialSiteSettings,
    orders: [],
    pageViews: 100,
    initialized: true,
    lastBackupAt: new Date().toISOString(),
  };
  saveStore(initialStore, true);
  return initialStore;
}

async function startServer() {
  const app = express();

  // Enable CORS headers for all routes
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Ensure local uploads directory exists and is static served
  const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');
  const DIST_UPLOADS_DIR = path.join(process.cwd(), 'dist', 'uploads');
  [UPLOADS_DIR, DIST_UPLOADS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use('/uploads', express.static(DIST_UPLOADS_DIR));

  // --- API ENDPOINTS ---

  // ImageKit Helper Instance
  function getImageKitInstance() {
    const publicKey = process.env.VITE_IMAGEKIT_PUBLIC_KEY || process.env.IMAGEKIT_PUBLIC_KEY || '';
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || '';
    const urlEndpoint = process.env.VITE_IMAGEKIT_URL_ENDPOINT || process.env.IMAGEKIT_URL_ENDPOINT || '';

    if (!publicKey || !privateKey || !urlEndpoint) {
      return null;
    }

    // Check for dummy/placeholder keys
    const isPlaceholder = 
      publicKey.includes('PUBLIC_KEY') || 
      privateKey.includes('PRIVATE_KEY') || 
      urlEndpoint.includes('URL_ENDPOINT') ||
      !publicKey.startsWith('public_') ||
      !privateKey.startsWith('private_') ||
      !urlEndpoint.startsWith('http');

    if (isPlaceholder) {
      return null;
    }

    return {
      ik: new ImageKit({ publicKey, privateKey, urlEndpoint }),
      publicKey,
      urlEndpoint,
    };
  }

  // ImageKit Authentication Endpoint (GET and POST)
  const handleImageKitAuth = (_req: express.Request, res: express.Response) => {
    try {
      const ikData = getImageKitInstance();
      if (!ikData) {
        console.warn('[IMAGEKIT_AUTH_NOTICE] ImageKit credentials not configured or using placeholders.');
        res.status(400).json({ error: 'ImageKit environment variables are missing or unconfigured.' });
        return;
      }
      const authParams = ikData.ik.getAuthenticationParameters();
      res.json({
        ...authParams,
        publicKey: ikData.publicKey,
        urlEndpoint: ikData.urlEndpoint,
      });
    } catch (err: any) {
      console.warn('[IMAGEKIT_AUTH_NOTICE]', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to generate ImageKit authentication parameters' });
    }
  };

  app.get('/api/imagekit/auth', handleImageKitAuth);
  app.post('/api/imagekit/auth', handleImageKitAuth);

  // ImageKit Server Upload Proxy Endpoint
  app.post('/api/imagekit/upload', async (req, res) => {
    try {
      const { image, file, fileName, folder = 'general', docId = 'temp' } = req.body;
      const payload = image || file;
      if (!payload) {
        res.status(400).json({ error: 'No image or file data provided' });
        return;
      }

      const ikData = getImageKitInstance();
      if (!ikData) {
        console.warn('[IMAGEKIT_UPLOAD_NOTICE] ImageKit is not configured with valid credentials on server.');
        res.status(400).json({ error: 'ImageKit is not configured with valid credentials on server.' });
        return;
      }

      const cleanFolder = folder.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const cleanDocId = docId.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const name = fileName || `img_${cleanDocId}_${Date.now()}`;

      const ikResult = await ikData.ik.upload({
        file: payload,
        fileName: name,
        folder: `/${cleanFolder}`,
        useUniqueFileName: true,
      });

      console.log(`[IMAGEKIT_SERVER_UPLOAD_SUCCESS] Uploaded ${name} to ImageKit -> ${ikResult.url}`);

      res.json({
        success: true,
        url: ikResult.url,
        fileId: ikResult.fileId,
        filePath: ikResult.filePath,
        storagePath: ikResult.filePath,
        name: ikResult.name,
        thumbnailUrl: ikResult.thumbnailUrl,
      });
    } catch (err: any) {
      console.warn('[IMAGEKIT_SERVER_UPLOAD_NOTICE] ImageKit server upload failed:', err?.message || err);
      res.status(500).json({ error: err?.message || 'ImageKit server upload failed' });
    }
  });

  // Image Upload API Endpoint (persistent server storage fallback)
  app.post('/api/upload', (req, res) => {
    try {
      const { image, folder = 'general', docId = 'temp' } = req.body;
      if (!image) {
        res.status(400).json({ error: 'No image data provided' });
        return;
      }

      let buffer: Buffer;
      let ext = 'png';

      if (typeof image === 'string' && image.startsWith('data:image/')) {
        const parts = image.split(';');
        const mime = parts[0].split(':')[1] || 'image/png';
        ext = mime.split('/')[1] || 'png';
        if (ext === 'jpeg') ext = 'jpg';
        if (ext === 'svg+xml') ext = 'svg';
        const base64Data = parts[1].replace(/^base64,/, '');
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        res.status(400).json({ error: 'Invalid image format. Expected base64 data URL.' });
        return;
      }

      const cleanFolder = folder.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const targetDir = path.join(UPLOADS_DIR, cleanFolder);
      const distTargetDir = path.join(DIST_UPLOADS_DIR, cleanFolder);

      [targetDir, distTargetDir].forEach((dir) => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      });

      const cleanDocId = docId.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const filename = `img_${cleanDocId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;
      const filePath = path.join(targetDir, filename);
      const distFilePath = path.join(distTargetDir, filename);

      fs.writeFileSync(filePath, buffer);
      try {
        fs.writeFileSync(distFilePath, buffer);
      } catch (e) {
        // ignore copy error
      }

      const publicUrl = `/uploads/${cleanFolder}/${filename}`;
      const storagePath = `${cleanFolder}/${filename}`;

      console.log(`[SERVER_UPLOAD_SUCCESS] Saved image to ${filePath} -> ${publicUrl}`);

      res.json({
        success: true,
        url: publicUrl,
        storagePath: storagePath,
        fileId: storagePath,
      });
    } catch (err: any) {
      console.error('[API_UPLOAD_ERROR]', err);
      res.status(500).json({ error: err?.message || 'Failed to save uploaded image' });
    }
  });

  // Get full store data
  app.get('/api/data', (_req, res) => {
    const store = loadStore();
    store.pageViews = (store.pageViews || 100) + 1;
    saveStore(store, false);
    res.json(store);
  });

  // Update store data
  app.post('/api/data', (req, res) => {
    const newStore = req.body as AppDataStore;
    if (!newStore || !Array.isArray(newStore.products)) {
      res.status(400).json({ error: 'Invalid store payload' });
      return;
    }
    const success = saveStore(newStore, true);
    if (success) {
      res.json({ status: 'ok', store: newStore });
    } else {
      res.status(500).json({ error: 'Failed to write data' });
    }
  });

  // Add new order
  app.post('/api/orders', (req, res) => {
    const store = loadStore();
    const newOrder = req.body;
    if (!newOrder || !newOrder.customerName) {
      res.status(400).json({ error: 'Invalid order details' });
      return;
    }

    store.orders = [newOrder, ...(store.orders || [])];
    saveStore(store, true);
    res.json({ status: 'ok', order: newOrder });
  });

  // Backup Management Endpoints
  app.get('/api/admin/backups', (_req, res) => {
    try {
      if (!fs.existsSync(BACKUPS_DIR)) {
        res.json({ backups: [] });
        return;
      }
      const files = fs.readdirSync(BACKUPS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((filename) => {
          const filePath = path.join(BACKUPS_DIR, filename);
          const stats = fs.statSync(filePath);
          let itemCount = 0;
          try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(raw);
            itemCount = Array.isArray(data.products) ? data.products.length : 0;
          } catch {
            // ignore
          }
          return {
            filename,
            size: stats.size,
            mtime: stats.mtime,
            itemCount,
            isLatest: filename === 'latest_backup.json',
          };
        })
        .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

      res.json({ backups: files });
    } catch (err) {
      res.status(500).json({ error: 'Failed to read backups directory' });
    }
  });

  app.post('/api/admin/backup', (_req, res) => {
    const store = loadStore();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `manual_backup_${timestamp}.json`;
    const backupPath = path.join(BACKUPS_DIR, backupName);
    
    try {
      fs.writeFileSync(backupPath, JSON.stringify(store, null, 2), 'utf-8');
      res.json({ status: 'ok', backupName });
    } catch (err) {
      res.status(500).json({ error: 'Failed to write manual backup' });
    }
  });

  app.post('/api/admin/restore', (req, res) => {
    const { filename } = req.body;
    if (!filename) {
      res.status(400).json({ error: 'Filename is required' });
      return;
    }
    const backupPath = path.join(BACKUPS_DIR, filename);
    if (!fs.existsSync(backupPath)) {
      res.status(404).json({ error: 'Backup file not found' });
      return;
    }

    try {
      const raw = fs.readFileSync(backupPath, 'utf-8');
      const restoredStore: AppDataStore = JSON.parse(raw);
      if (!restoredStore || !Array.isArray(restoredStore.products)) {
        res.status(400).json({ error: 'Invalid backup file structure' });
        return;
      }
      saveStore(restoredStore, false);
      res.json({ status: 'ok', store: restoredStore });
    } catch (err) {
      res.status(500).json({ error: 'Failed to restore backup' });
    }
  });

  // Fallback 404 handler for API routes
  app.all('/api/*', (req, res) => {
    res.status(404).json({ success: false, error: `API route ${req.method} ${req.path} not found.` });
  });

  // Vite development vs Production static serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
