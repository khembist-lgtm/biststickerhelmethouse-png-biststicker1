import React, { useState, useEffect } from 'react';
import { 
  AppDataStore, 
  CartItem, 
  Category, 
  HeroSlide, 
  Product, 
  SiteSettings 
} from './types';
import { 
  fetchStoreData, 
  saveStoreData, 
  saveBackendStoreData,
  formatNPR 
} from './lib/api';
import {
  saveProductToFirestore,
  deleteProductFromFirestore,
  saveCategoryToFirestore,
  deleteCategoryFromFirestore,
  saveHeroSlideToFirestore,
  deleteHeroSlideFromFirestore,
  saveSettingsToFirestore,
  subscribeToStoreChanges,
  syncStoreToFirestore
} from './lib/firestoreSync';
import { deleteStorageImage } from './lib/storage';
import { initialCategories, initialHeroSlides, initialProducts, initialSiteSettings } from './data/initialData';

// Public Components
import { Header } from './components/Header';
import { HeroSlider } from './components/HeroSlider';
import { CategoryGrid } from './components/CategoryGrid';
import { ProductGrid } from './components/ProductGrid';
import { ProductDetailsModal } from './components/ProductDetailsModal';
import { CartDrawer } from './components/CartDrawer';
import { AboutSection } from './components/AboutSection';
import { ServicesSection } from './components/ServicesSection';
import { LocationSection } from './components/LocationSection';
import { Footer } from './components/Footer';
import { FloatingWhatsApp } from './components/FloatingWhatsApp';
import { Toast } from './components/Toast';

// Admin Components
import { AdminLoginModal } from './components/admin/AdminLoginModal';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { AdminProductManager } from './components/admin/AdminProductManager';
import { AdminCategoryManager } from './components/admin/AdminCategoryManager';
import { AdminHeroManager } from './components/admin/AdminHeroManager';
import { AdminSettingsManager } from './components/admin/AdminSettingsManager';
import { AdminBackupManager } from './components/admin/AdminBackupManager';
import { AdminGoogleDriveManager } from './components/admin/AdminGoogleDriveManager';

export default function App() {
  // Main Store State
  const [storeData, setStoreData] = useState<AppDataStore>({
    products: initialProducts,
    categories: initialCategories,
    heroSlides: initialHeroSlides,
    settings: initialSiteSettings,
    orders: [],
    pageViews: 150,
  });

  const [isLoading, setIsLoading] = useState(true);

  // Storefront Interactive States
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [wishlistIds, setWishlistIds] = useState<string[]>([]);
  const [selectedProductDetails, setSelectedProductDetails] = useState<Product | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Admin States
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<'overview' | 'products' | 'categories' | 'hero' | 'settings' | 'backups' | 'drive'>('overview');

  // Trigger modals for Admin quick add
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [isAddSlideOpen, setIsAddSlideOpen] = useState(false);

  // Check URL path for /admin
  useEffect(() => {
    if (window.location.pathname === '/admin' || window.location.hash === '#admin') {
      setIsAdminLoginOpen(true);
    }
  }, []);

  // Fetch Store Data on Mount & Subscribe to Real-time Firestore Changes
  useEffect(() => {
    async function init() {
      const data = await fetchStoreData();
      setStoreData(data);
      setIsLoading(false);
    }
    init();

    // Live subscription across all browsers
    const unsubscribe = subscribeToStoreChanges((freshStore) => {
      setStoreData(freshStore);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Show Notification Toast
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  // Cart Handlers
  const handleAddToCart = (product: Product, quantity = 1) => {
    setCartItems((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      return [...prev, { product, quantity }];
    });
    showToast(`Added "${product.name}" to cart!`);
  };

  const handleUpdateCartQuantity = (productId: string, quantity: number) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.product.id === productId ? { ...item, quantity } : item
      )
    );
  };

  const handleRemoveCartItem = (productId: string) => {
    setCartItems((prev) => prev.filter((item) => item.product.id !== productId));
    showToast('Item removed from cart');
  };

  const handleClearCart = () => {
    setCartItems([]);
  };

  // Wishlist Handlers
  const handleToggleWishlist = (product: Product) => {
    setWishlistIds((prev) => {
      const exists = prev.includes(product.id);
      if (exists) {
        showToast('Removed from wishlist');
        return prev.filter((id) => id !== product.id);
      } else {
        showToast('Added to wishlist!');
        return [...prev, product.id];
      }
    });
  };

  // Admin CRUD Persistence Handlers (Database-First: UI only updates after Firestore succeeds)
  const handleSaveProduct = async (product: Product) => {
    // 1. Write to Firestore first
    const res = await saveProductToFirestore(product);
    if (!res.success) {
      showToast(`Failed to save product to Firestore: ${res.error || 'Unknown error'}`, 'error');
      console.error(`[SAVE_PRODUCT_FAILED] ID: ${product.id} | Error: ${res.error}`);
      return;
    }

    // 2. Only update UI state after Firestore write and verification succeeds
    const updatedProducts = storeData.products.some((p) => p.id === product.id)
      ? storeData.products.map((p) => (p.id === product.id ? product : p))
      : [product, ...storeData.products];

    const newStore: AppDataStore = {
      ...storeData,
      products: updatedProducts,
    };

    setStoreData(newStore);
    saveBackendStoreData(newStore);
    showToast(`Product "${product.name}" saved!`);
    setIsAddProductOpen(false);
  };

  const handleDeleteProduct = async (productId: string) => {
    const targetProd = storeData.products.find((p) => p.id === productId);

    // 1. Send DELETE operation to Firestore and wait for database verification
    const res = await deleteProductFromFirestore(productId);

    if (!res.success) {
      // Keep product visible in React state & show real Firebase error
      showToast(`Delete failed: ${res.error || 'Firestore error'}`, 'error');
      console.error(`[DELETE_FAILED] Product ID: ${productId} | Error: ${res.error}`);
      return;
    }

    // Clean up corresponding storage files if any
    if (targetProd) {
      if (targetProd.storagePaths && targetProd.storagePaths.length > 0) {
        targetProd.storagePaths.forEach((sp) => deleteStorageImage(sp));
      }
      targetProd.images?.forEach((img) => deleteStorageImage(undefined, img));
    }

    // 2. Only after Firestore delete succeeds and document non-existence is verified, update React state
    const updatedProducts = storeData.products.filter((p) => p.id !== productId);
    const newStore: AppDataStore = {
      ...storeData,
      products: updatedProducts,
    };

    setStoreData(newStore);
    saveBackendStoreData(newStore);
    showToast('Product successfully deleted from database.');
  };

  const handleSaveCategory = async (category: Category) => {
    const res = await saveCategoryToFirestore(category);
    if (!res.success) {
      showToast(`Failed to save category to Firestore: ${res.error}`, 'error');
      return;
    }

    const updatedCategories = storeData.categories.some((c) => c.id === category.id)
      ? storeData.categories.map((c) => (c.id === category.id ? category : c))
      : [...storeData.categories, category];

    const newStore: AppDataStore = {
      ...storeData,
      categories: updatedCategories,
    };

    setStoreData(newStore);
    saveBackendStoreData(newStore);
    showToast(`Category "${category.name}" saved!`);
    setIsAddCategoryOpen(false);
  };

  const handleDeleteCategory = async (categoryId: string) => {
    const targetCat = storeData.categories.find((c) => c.id === categoryId);

    const res = await deleteCategoryFromFirestore(categoryId);
    if (!res.success) {
      showToast(`Delete failed: ${res.error}`, 'error');
      return;
    }

    if (targetCat) {
      deleteStorageImage(targetCat.storagePath, targetCat.image);
    }

    const updatedCategories = storeData.categories.filter((c) => c.id !== categoryId);
    const newStore: AppDataStore = {
      ...storeData,
      categories: updatedCategories,
    };

    setStoreData(newStore);
    saveBackendStoreData(newStore);
    showToast('Category deleted.');
  };

  const handleSaveSlide = async (slide: HeroSlide) => {
    const res = await saveHeroSlideToFirestore(slide);
    if (!res.success) {
      showToast(`Failed to save slide: ${res.error}`, 'error');
      return;
    }

    const updatedSlides = storeData.heroSlides.some((s) => s.id === slide.id)
      ? storeData.heroSlides.map((s) => (s.id === slide.id ? slide : s))
      : [...storeData.heroSlides, slide];

    const newStore: AppDataStore = {
      ...storeData,
      heroSlides: updatedSlides,
    };

    setStoreData(newStore);
    saveBackendStoreData(newStore);
    showToast(`Hero slide saved!`);
    setIsAddSlideOpen(false);
  };

  const handleDeleteSlide = async (slideId: string) => {
    const targetSlide = storeData.heroSlides.find((s) => s.id === slideId);

    const res = await deleteHeroSlideFromFirestore(slideId);
    if (!res.success) {
      showToast(`Delete failed: ${res.error}`, 'error');
      return;
    }

    if (targetSlide) {
      deleteStorageImage(targetSlide.storagePath, targetSlide.image);
    }

    const updatedSlides = storeData.heroSlides.filter((s) => s.id !== slideId);
    const newStore: AppDataStore = {
      ...storeData,
      heroSlides: updatedSlides,
    };

    setStoreData(newStore);
    saveBackendStoreData(newStore);
    showToast('Hero slide deleted.');
  };

  const handleSaveSettings = async (settings: SiteSettings) => {
    const res = await saveSettingsToFirestore(settings);
    if (!res.success) {
      showToast(`Failed to save settings: ${res.error}`, 'error');
      return;
    }

    const newStore: AppDataStore = {
      ...storeData,
      settings,
    };

    setStoreData(newStore);
    saveBackendStoreData(newStore);
    showToast('Store settings updated successfully!');
  };

  const handleResetDemoData = async () => {
    if (window.confirm('Reset all store content to initial demo products and settings?')) {
      const demoStore: AppDataStore = {
        products: initialProducts,
        categories: initialCategories,
        heroSlides: initialHeroSlides,
        settings: initialSiteSettings,
        orders: [],
        pageViews: 160,
      };
      setStoreData(demoStore);
      await syncStoreToFirestore(demoStore);
      await saveStoreData(demoStore);
      showToast('Reset to demo data completed!');
    }
  };

  // Related products calculator for product modal
  const relatedProducts = selectedProductDetails
    ? storeData.products.filter(
        (p) =>
          p.id !== selectedProductDetails.id &&
          p.category.toLowerCase() === selectedProductDetails.category.toLowerCase()
      )
    : [];

  const cartTotalCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);

  return (
    <div className="min-h-screen bg-[#f8f7f4] text-[#1a1a1a] flex flex-row font-sans selection:bg-[#ff3300] selection:text-white">
      {/* Toast Notification Banner */}
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Architectural Left Sidebar (Visible on Desktop) */}
      <aside className="hidden xl:flex w-20 border-r border-[#1a1a1a]/10 bg-[#f8f7f4] text-[#1a1a1a] flex-col justify-between py-10 items-center sticky top-0 h-screen shrink-0 z-30 select-none">
        <div className="font-black text-2xl tracking-tighter cursor-pointer" onClick={() => setSelectedCategory('All')}>
          BS<span className="text-[#ff3300]">.</span>
        </div>

        <div className="writing-mode-vertical font-mono-meta text-[10px] uppercase tracking-[0.25em] text-[#1a1a1a]/60 py-4 border-y border-[#1a1a1a]/10">
          Precision Tailored Customization
        </div>

        <div className="writing-mode-vertical font-mono-meta text-[9px] uppercase tracking-widest text-[#1a1a1a]/40">
          Nepal — 2026
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Main Sticky Header */}
        <Header
          settings={storeData.settings}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          cartCount={cartTotalCount}
          wishlistCount={wishlistIds.length}
          onOpenCart={() => setIsCartOpen(true)}
          onOpenWishlist={() => {
            setSelectedCategory('All');
            showToast(`Wishlist contains ${wishlistIds.length} saved items`);
          }}
          onSelectCategory={(cat) => setSelectedCategory(cat)}
          selectedCategory={selectedCategory}
          onOpenAdmin={() => {
            if (isAdminMode) {
              setAdminTab('overview');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              setIsAdminLoginOpen(true);
            }
          }}
          isAdminMode={isAdminMode}
        />

      {/* Admin Panel Controls View */}
      {isAdminMode && (
        <div>
          <AdminDashboard
            storeData={storeData}
            activeTab={adminTab}
            setActiveTab={setAdminTab}
            onExitAdmin={() => setIsAdminMode(false)}
            onResetDemo={handleResetDemoData}
            onOpenAddProduct={() => {
              setAdminTab('products');
              setIsAddProductOpen(true);
            }}
            onOpenAddCategory={() => {
              setAdminTab('categories');
              setIsAddCategoryOpen(true);
            }}
            onOpenAddSlide={() => {
              setAdminTab('hero');
              setIsAddSlideOpen(true);
            }}
          />

          {adminTab === 'products' && (
            <AdminProductManager
              products={storeData.products}
              categories={storeData.categories}
              onSaveProduct={handleSaveProduct}
              onDeleteProduct={handleDeleteProduct}
              isAddModalOpenInitially={isAddProductOpen}
            />
          )}

          {adminTab === 'categories' && (
            <AdminCategoryManager
              categories={storeData.categories}
              onSaveCategory={handleSaveCategory}
              onDeleteCategory={handleDeleteCategory}
              isAddModalOpenInitially={isAddCategoryOpen}
            />
          )}

          {adminTab === 'hero' && (
            <AdminHeroManager
              slides={storeData.heroSlides}
              onSaveSlide={handleSaveSlide}
              onDeleteSlide={handleDeleteSlide}
              isAddModalOpenInitially={isAddSlideOpen}
            />
          )}

          {adminTab === 'settings' && (
            <AdminSettingsManager
              settings={storeData.settings}
              onSaveSettings={handleSaveSettings}
            />
          )}

          {adminTab === 'drive' && (
            <div className="max-w-7xl mx-auto px-4 py-6">
              <AdminGoogleDriveManager />
            </div>
          )}

          {adminTab === 'backups' && (
            <div className="max-w-7xl mx-auto px-4 py-6">
              <AdminBackupManager
                storeData={storeData}
                onStoreUpdated={(updatedStore) => {
                  setStoreData(updatedStore);
                  showToast('Database updated successfully!');
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* PUBLIC STOREFRONT SECTIONS */}
      <main className="flex-1">
        {/* Hero Slider */}
        <HeroSlider slides={storeData.heroSlides} settings={storeData.settings} />

        {/* Categories Section */}
        <CategoryGrid
          categories={storeData.categories}
          onSelectCategory={(catName) => {
            setSelectedCategory(catName);
            const el = document.getElementById('featured-products');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }}
        />

        {/* Featured Products & Catalog */}
        <ProductGrid
          products={storeData.products}
          categories={storeData.categories}
          settings={storeData.settings}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onAddToCart={(product) => handleAddToCart(product, 1)}
          onViewDetails={(product) => setSelectedProductDetails(product)}
          onToggleWishlist={handleToggleWishlist}
          wishlistIds={wishlistIds}
        />

        {/* Services Section */}
        <ServicesSection settings={storeData.settings} />

        {/* About Us Section */}
        <AboutSection settings={storeData.settings} />

        {/* Location & Contact Section */}
        <LocationSection settings={storeData.settings} />
      </main>

      {/* Footer */}
      <Footer
        settings={storeData.settings}
        onSelectCategory={(cat) => setSelectedCategory(cat)}
        onOpenAdmin={() => setIsAdminLoginOpen(true)}
      />

      {/* Floating WhatsApp Quick Order Button */}
      <FloatingWhatsApp settings={storeData.settings} />

      {/* Product Details Modal */}
      <ProductDetailsModal
        product={selectedProductDetails}
        onClose={() => setSelectedProductDetails(null)}
        settings={storeData.settings}
        onAddToCart={handleAddToCart}
        onToggleWishlist={handleToggleWishlist}
        isWishlisted={selectedProductDetails ? wishlistIds.includes(selectedProductDetails.id) : false}
        relatedProducts={relatedProducts}
        onSelectProduct={(p) => setSelectedProductDetails(p)}
      />

      {/* Shopping Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cartItems}
        onUpdateQuantity={handleUpdateCartQuantity}
        onRemoveItem={handleRemoveCartItem}
        onClearCart={handleClearCart}
        settings={storeData.settings}
        onOrderSuccess={(msg) => showToast(msg, 'success')}
      />

      {/* Admin Login Password Protection Modal */}
      <AdminLoginModal
        isOpen={isAdminLoginOpen}
        onClose={() => setIsAdminLoginOpen(false)}
        onLoginSuccess={() => {
          setIsAdminMode(true);
          setAdminTab('overview');
          showToast('Admin access granted!');
        }}
      />
      </div>
    </div>
  );
}
