export interface Product {
  id: string;
  name: string;
  slug: string;
  category: string; // e.g. "Bike Stickers", "Helmets", "Bike Accessories", etc.
  price: number; // in NPR
  oldPrice?: number; // in NPR
  discount?: number; // percentage e.g. 15
  description: string;
  images: string[];
  storagePaths?: string[];
  stockStatus: 'In Stock' | 'Out of Stock' | 'Limited Stock';
  stockCount?: number;
  sku: string;
  isFeatured: boolean;
  isActive: boolean;
  tags?: string[];
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: string;
  storagePath?: string;
  itemCount?: number;
}

export interface HeroSlide {
  id: string;
  smallText: string;
  title: string;
  description: string;
  image: string;
  storagePath?: string;
  primaryBtnText: string;
  primaryBtnLink: string;
  secondaryBtnText?: string;
  secondaryBtnLink?: string;
  order: number;
  isActive: boolean;
}

export interface SiteSettings {
  shopName: string;
  tagline: string;
  phone: string;
  whatsappNumber: string; // International format without + e.g. "9779848419968"
  whatsappDisplay: string; // Display format e.g. "9848419968"
  email: string;
  address: string;
  city: string;
  district: string;
  country: string;
  openingHours: string;
  facebookUrl: string;
  tiktokUrl: string;
  instagramUrl: string;
  googleMapsEmbedUrl: string;
  logoUrl: string;
  logoStoragePath?: string;
  aboutText: string;
  aboutImage: string;
  aboutImageStoragePath?: string;
  footerText: string;
  adminPasswordHash?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Service {
  id: string;
  title: string;
  description: string;
  iconName: string;
  image: string;
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  cityArea: string;
  orderNotes?: string;
  items: {
    productId: string;
    productName: string;
    price: number;
    quantity: number;
  }[];
  totalAmount: number;
  status: 'Pending WhatsApp' | 'Confirmed' | 'Completed' | 'Cancelled';
  createdAt: string;
}

export interface AppDataStore {
  products: Product[];
  categories: Category[];
  heroSlides: HeroSlide[];
  settings: SiteSettings;
  orders: Order[];
  pageViews: number;
  initialized?: boolean;
  lastBackupAt?: string;
}
