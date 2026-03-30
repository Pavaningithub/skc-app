import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, where, setDoc, onSnapshot,
  increment,
  type Unsubscribe,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db } from "./firebase";
import { generateReferralCode } from "./utils";
import type {
  Product, StockItem, RawMaterial, RawMaterialPurchase,
  Batch, Customer, Order, Expense, Subscription, Feedback, AdminAction, AdminActionType, AdminUser,
} from "./types";

// ─── Collection Names ─────────────────────────────────────────────────────────
export const COLLECTIONS = {
  PRODUCTS:              "products",
  STOCK:                 "stock",
  RAW_MATERIALS:         "rawMaterials",
  RAW_MATERIAL_PURCHASES:"rawMaterialPurchases",
  BATCHES:               "batches",
  CUSTOMERS:             "customers",
  ORDERS:                "orders",
  EXPENSES:              "expenses",
  SUBSCRIPTIONS:         "subscriptions",
  FEEDBACK:              "feedback",
  SETTINGS:              "settings",
  ADMIN_ACTIVITY:        "adminActivity",
  ADMIN_USERS:           "adminUsers",
} as const;

function now() { return new Date().toISOString(); }

// ─── File Upload (Firebase Storage) ──────────────────────────────────────────
export async function uploadBillPhoto(file: File, purchaseId: string): Promise<string> {
  const storage = getStorage();
  const storageRef = ref(storage, `bills/${purchaseId}_${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

// ─── Products ────────────────────────────────────────────────────────────────
export const productsService = {
  async getAll(): Promise<Product[]> {
    const snap = await getDocs(collection(db, COLLECTIONS.PRODUCTS));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
    return items.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.name.localeCompare(b.name));
  },
  async getActive(): Promise<Product[]> {
    const snap = await getDocs(query(collection(db, COLLECTIONS.PRODUCTS), where("isActive", "==", true)));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
    return items.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.name.localeCompare(b.name));
  },
  async add(product: Omit<Product, "id">): Promise<string> {
    const ref = await addDoc(collection(db, COLLECTIONS.PRODUCTS), { ...product, createdAt: now(), updatedAt: now() });
    return ref.id;
  },
  async update(id: string, data: Partial<Product>): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.PRODUCTS, id), { ...data, updatedAt: now() });
  },
  async delete(id: string): Promise<void> {
    await deleteDoc(doc(db, COLLECTIONS.PRODUCTS, id));
  },
  subscribe(cb: (items: Product[]) => void): Unsubscribe {
    return onSnapshot(collection(db, COLLECTIONS.PRODUCTS), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
      cb(items.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.name.localeCompare(b.name)));
    });
  },
};

// ─── Stock ────────────────────────────────────────────────────────────────────
export const stockService = {
  async getAll(): Promise<StockItem[]> {
    const snap = await getDocs(collection(db, COLLECTIONS.STOCK));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as StockItem));
  },
  async upsert(item: Omit<StockItem, "id"> & { id?: string }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...data } = item;
    if (id) {
      // editing an existing entry by doc id
      await updateDoc(doc(db, COLLECTIONS.STOCK, id), { ...data, updatedAt: now() });
    } else {
      // adding — check if a doc already exists for this productId to avoid duplicates
      const existing = await getDocs(
        query(collection(db, COLLECTIONS.STOCK), where("productId", "==", item.productId))
      );
      if (!existing.empty) {
        await updateDoc(doc(db, COLLECTIONS.STOCK, existing.docs[0].id), { ...data, updatedAt: now() });
      } else {
        await addDoc(collection(db, COLLECTIONS.STOCK), { ...data, updatedAt: now() });
      }
    }
  },
  async deduct(productId: string, quantity: number, meta?: { productName: string; unit: string }): Promise<void> {
    const snap = await getDocs(query(collection(db, COLLECTIONS.STOCK), where("productId", "==", productId)));
    if (!snap.empty) {
      // Stock entry exists — deduct (allow going negative so deficit is visible)
      const stockDoc = snap.docs[0];
      const current = (stockDoc.data() as StockItem).quantityAvailable;
      await updateDoc(doc(db, COLLECTIONS.STOCK, stockDoc.id), {
        quantityAvailable: current - quantity,
        updatedAt: now(),
      });
    } else if (meta) {
      // No stock entry yet — create one with negative quantity so the deficit is visible
      await addDoc(collection(db, COLLECTIONS.STOCK), {
        productId,
        productName: meta.productName,
        unit: meta.unit,
        quantityAvailable: -quantity,
        lowStockThreshold: 0,
        updatedAt: now(),
      });
    }
  },
  async getLowStock(): Promise<StockItem[]> {
    const all = await this.getAll();
    return all.filter(s => s.quantityAvailable <= s.lowStockThreshold);
  },
  async delete(id: string): Promise<void> {
    await deleteDoc(doc(db, COLLECTIONS.STOCK, id));
  },
  subscribe(cb: (items: StockItem[]) => void): Unsubscribe {
    return onSnapshot(collection(db, COLLECTIONS.STOCK), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as StockItem)));
    });
  },
};

// ─── Raw Materials ────────────────────────────────────────────────────────────
export const rawMaterialsService = {
  async getAll(): Promise<RawMaterial[]> {
    const snap = await getDocs(collection(db, COLLECTIONS.RAW_MATERIALS));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as RawMaterial));
  },
  async add(item: Omit<RawMaterial, "id">): Promise<string> {
    const ref = await addDoc(collection(db, COLLECTIONS.RAW_MATERIALS), { ...item, updatedAt: now() });
    return ref.id;
  },
  async update(id: string, data: Partial<RawMaterial>): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.RAW_MATERIALS, id), { ...data, updatedAt: now() });
  },
  async delete(id: string): Promise<void> {
    await deleteDoc(doc(db, COLLECTIONS.RAW_MATERIALS, id));
  },
  subscribe(cb: (items: RawMaterial[]) => void): Unsubscribe {
    return onSnapshot(collection(db, COLLECTIONS.RAW_MATERIALS), snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as RawMaterial)));
    });
  },
};

// ─── Raw Material Purchases ───────────────────────────────────────────────────
export const rawMaterialPurchasesService = {
  async getAll(): Promise<RawMaterialPurchase[]> {
    const snap = await getDocs(collection(db, COLLECTIONS.RAW_MATERIAL_PURCHASES));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as RawMaterialPurchase));
    return items.sort((a, b) => b.date.localeCompare(a.date));
  },
  async add(purchase: Omit<RawMaterialPurchase, "id">): Promise<string> {
    const ref = await addDoc(collection(db, COLLECTIONS.RAW_MATERIAL_PURCHASES), { ...purchase, createdAt: now() });
    return ref.id;
  },
  async updateBillPhoto(id: string, billPhotoUrl: string): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.RAW_MATERIAL_PURCHASES, id), { billPhotoUrl });
  },
  async delete(id: string): Promise<void> {
    await deleteDoc(doc(db, COLLECTIONS.RAW_MATERIAL_PURCHASES, id));
  },
};

// ─── Batches ──────────────────────────────────────────────────────────────────
export const batchesService = {
  async getAll(): Promise<Batch[]> {
    const snap = await getDocs(collection(db, COLLECTIONS.BATCHES));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Batch));
    return items.sort((a, b) => b.date.localeCompare(a.date));
  },
  async add(batch: Omit<Batch, "id">): Promise<string> {
    const ref = await addDoc(collection(db, COLLECTIONS.BATCHES), { ...batch, createdAt: now() });
    return ref.id;
  },
  async update(id: string, data: Partial<Omit<Batch, 'id'>>): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.BATCHES, id), { ...data, updatedAt: now() });
  },
  async delete(id: string): Promise<void> {
    await deleteDoc(doc(db, COLLECTIONS.BATCHES, id));
  },
  subscribe(cb: (items: Batch[]) => void): Unsubscribe {
    return onSnapshot(collection(db, COLLECTIONS.BATCHES), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Batch));
      cb(items.sort((a, b) => b.date.localeCompare(a.date)));
    });
  },
};

// ─── Customers ────────────────────────────────────────────────────────────────
export const customersService = {
  async getAll(): Promise<Customer[]> {
    const snap = await getDocs(collection(db, COLLECTIONS.CUSTOMERS));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer));
    return items.sort((a, b) => a.name.localeCompare(b.name));
  },
  async getByWhatsapp(whatsapp: string): Promise<Customer | null> {
    const snap = await getDocs(query(collection(db, COLLECTIONS.CUSTOMERS), where("whatsapp", "==", whatsapp)));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as Customer;
  },
  async upsert(data: Omit<Customer, "id" | "totalOrders" | "totalSpent" | "pendingAmount" | "referralCredit">, id?: string): Promise<string> {
    if (id) {
      await updateDoc(doc(db, COLLECTIONS.CUSTOMERS, id), data);
      return id;
    }
    // Auto-generate a unique referral code for every new customer
    const referralCode = data.referralCode || generateReferralCode(data.name);
    const ref = await addDoc(collection(db, COLLECTIONS.CUSTOMERS), {
      ...data, referralCode, totalOrders: 0, totalSpent: 0, pendingAmount: 0, referralCredit: 0, createdAt: now(),
    });
    return ref.id;
  },
  async getByReferralCode(code: string): Promise<Customer | null> {
    const snap = await getDocs(query(collection(db, COLLECTIONS.CUSTOMERS), where("referralCode", "==", code.toUpperCase().trim())));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as Customer;
  },
  /** Add ₹ referral credit to a customer (called when someone they referred places an order) */
  async addReferralCredit(customerId: string, amount: number): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.CUSTOMERS, customerId), { referralCredit: increment(amount) });
  },
  /** Deduct ₹ referral credit when customer redeems it on an order */
  async deductReferralCredit(customerId: string, amount: number): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.CUSTOMERS, customerId), { referralCredit: increment(-amount) });
  },
  async update(id: string, data: Partial<Customer>): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.CUSTOMERS, id), data);
  },
  async updateAfterOrder(id: string, amount: number, paymentStatus: string): Promise<void> {
    const docSnap = await getDoc(doc(db, COLLECTIONS.CUSTOMERS, id));
    if (!docSnap.exists()) return;
    const c = docSnap.data() as Customer;
    await updateDoc(doc(db, COLLECTIONS.CUSTOMERS, id), {
      totalOrders: (c.totalOrders || 0) + 1,
      totalSpent: (c.totalSpent || 0) + amount,
      pendingAmount: paymentStatus === "pending" ? (c.pendingAmount || 0) + amount : (c.pendingAmount || 0),
    });
  },
  // Adjust totals when an order's total changes (e.g. after edit).
  // Recalculates from ALL orders for this customer so any prior drift is healed.
  async adjustAfterOrderEdit(customerId: string, _oldTotal: number, _newTotal: number, _paymentStatus: string): Promise<void> {
    const ordersSnap = await getDocs(
      query(collection(db, COLLECTIONS.ORDERS), where("customerId", "==", customerId))
    );
    const orders = ordersSnap.docs.map(d => d.data() as Order);
    const totalSpent = orders.reduce((s, o) => s + (o.total || 0), 0);
    const pendingAmount = orders
      .filter(o => o.paymentStatus === "pending")
      .reduce((s, o) => s + (o.total || 0), 0);
    const totalOrders = orders.length;
    await updateDoc(doc(db, COLLECTIONS.CUSTOMERS, customerId), {
      totalSpent: Math.max(0, totalSpent),
      pendingAmount: Math.max(0, pendingAmount),
      totalOrders,
    });
  },
  subscribe(cb: (items: Customer[]) => void): Unsubscribe {
    return onSnapshot(collection(db, COLLECTIONS.CUSTOMERS), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer));
      cb(items.sort((a, b) => a.name.localeCompare(b.name)));
    });
  },
};

// ─── Orders ──────────────────────────────────────────────────────────────────
export const ordersService = {
  async getAll(): Promise<Order[]> {
    const snap = await getDocs(collection(db, COLLECTIONS.ORDERS));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Order));
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async getById(id: string): Promise<Order | null> {
    const docSnap = await getDoc(doc(db, COLLECTIONS.ORDERS, id));
    if (!docSnap.exists()) return null;
    return { id: docSnap.id, ...docSnap.data() } as Order;
  },
  async add(order: Omit<Order, "id">): Promise<string> {
    const ref = await addDoc(collection(db, COLLECTIONS.ORDERS), { ...order, createdAt: now(), updatedAt: now() });
    return ref.id;
  },
  async updateStatus(id: string, status: Order["status"], extra?: Partial<Order>): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.ORDERS, id), {
      status, updatedAt: now(), ...(extra || {}),
      ...(status === "delivered" ? { deliveredAt: now() } : {}),
    });
  },
  async updatePayment(id: string, paymentStatus: Order["paymentStatus"]): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.ORDERS, id), { paymentStatus, updatedAt: now() });
    // Recalculate customer's pendingAmount from all orders so it stays in sync
    const orderSnap = await getDoc(doc(db, COLLECTIONS.ORDERS, id));
    const customerId = orderSnap.exists() ? (orderSnap.data() as Order).customerId : undefined;
    if (customerId) {
      const ordersSnap = await getDocs(
        query(collection(db, COLLECTIONS.ORDERS), where('customerId', '==', customerId))
      );
      const orders = ordersSnap.docs.map(d => d.data() as Order);
      const pendingAmount = orders
        .filter(o => o.paymentStatus === 'pending')
        .reduce((s, o) => s + (o.total || 0), 0);
      await updateDoc(doc(db, COLLECTIONS.CUSTOMERS, customerId), {
        pendingAmount: Math.max(0, pendingAmount),
      });
    }
  },
  async update(id: string, data: Partial<Order>): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.ORDERS, id), { ...data, updatedAt: now() });
  },
  async delete(id: string): Promise<void> {
    await deleteDoc(doc(db, COLLECTIONS.ORDERS, id));
  },
  // Real-time listener for all orders
  subscribe(cb: (items: Order[]) => void): Unsubscribe {
    return onSnapshot(collection(db, COLLECTIONS.ORDERS), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Order));
      cb(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    });
  },
  // Real-time listener: calls onNew(order) for every order created since subscribeTime
  subscribeToNewOrders(since: string, onNew: (order: Order) => void): Unsubscribe {
    const q = query(
      collection(db, COLLECTIONS.ORDERS),
      where('createdAt', '>', since),
    );
    return onSnapshot(q, snap => {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          onNew({ id: change.doc.id, ...change.doc.data() } as Order);
        }
      });
    });
  },
};

// ─── Expenses ────────────────────────────────────────────────────────────────
export const expensesService = {
  async getAll(): Promise<Expense[]> {
    const snap = await getDocs(collection(db, COLLECTIONS.EXPENSES));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Expense));
    return items.sort((a, b) => b.date.localeCompare(a.date));
  },
  async getByMonth(year: number, month: number): Promise<Expense[]> {
    const start = new Date(year, month - 1, 1).toISOString();
    const end = new Date(year, month, 0, 23, 59, 59).toISOString();
    const snap = await getDocs(query(
      collection(db, COLLECTIONS.EXPENSES),
      where("date", ">=", start),
      where("date", "<=", end),
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Expense));
  },
  async add(expense: Omit<Expense, "id">): Promise<string> {
    const ref = await addDoc(collection(db, COLLECTIONS.EXPENSES), { ...expense, createdAt: now() });
    return ref.id;
  },
  async delete(id: string): Promise<void> {
    await deleteDoc(doc(db, COLLECTIONS.EXPENSES, id));
  },
  subscribe(cb: (items: Expense[]) => void): Unsubscribe {
    return onSnapshot(collection(db, COLLECTIONS.EXPENSES), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Expense));
      cb(items.sort((a, b) => b.date.localeCompare(a.date)));
    });
  },
};

// ─── Subscriptions ────────────────────────────────────────────────────────────
export const subscriptionsService = {
  async getAll(): Promise<Subscription[]> {
    const snap = await getDocs(collection(db, COLLECTIONS.SUBSCRIPTIONS));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Subscription));
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async add(sub: Omit<Subscription, "id">): Promise<string> {
    const ref = await addDoc(collection(db, COLLECTIONS.SUBSCRIPTIONS), { ...sub, createdAt: now() });
    return ref.id;
  },
  async update(id: string, data: Partial<Subscription>): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.SUBSCRIPTIONS, id), data);
  },
  subscribe(cb: (items: Subscription[]) => void): Unsubscribe {
    return onSnapshot(collection(db, COLLECTIONS.SUBSCRIPTIONS), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Subscription));
      cb(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    });
  },
};

// ─── Feedback ────────────────────────────────────────────────────────────────
export const feedbackService = {
  async getAll(): Promise<Feedback[]> {
    const snap = await getDocs(collection(db, COLLECTIONS.FEEDBACK));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Feedback));
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async getPublic(): Promise<Feedback[]> {
    const snap = await getDocs(query(collection(db, COLLECTIONS.FEEDBACK), where("isPublic", "==", true)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Feedback));
  },
  async add(feedback: Omit<Feedback, "id">): Promise<string> {
    const ref = await addDoc(collection(db, COLLECTIONS.FEEDBACK), { ...feedback, createdAt: now() });
    return ref.id;
  },
  async getByOrder(orderId: string): Promise<Feedback | null> {
    const snap = await getDocs(query(collection(db, COLLECTIONS.FEEDBACK), where("orderId", "==", orderId)));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as Feedback;
  },
  subscribe(cb: (items: Feedback[]) => void): Unsubscribe {
    return onSnapshot(collection(db, COLLECTIONS.FEEDBACK), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Feedback));
      cb(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    });
  },
};

// ─── Settings (PIN) ───────────────────────────────────────────────────────────
// ─── Admin Users ──────────────────────────────────────────────────────────────
export const adminUsersService = {
  async getAll(): Promise<AdminUser[]> {
    const snap = await getDocs(collection(db, COLLECTIONS.ADMIN_USERS));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as AdminUser));
  },
  async getByUsername(username: string): Promise<AdminUser | null> {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.ADMIN_USERS), where("username", "==", username.toLowerCase()))
    );
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as AdminUser;
  },
  async verifyPin(username: string, pin: string): Promise<AdminUser | null> {
    const user = await this.getByUsername(username);
    if (!user || user.pin !== pin) return null;
    return user;
  },
  async changePin(userId: string, newPin: string): Promise<void> {
    await updateDoc(doc(db, COLLECTIONS.ADMIN_USERS, userId), {
      pin: newPin,
      mustChangePin: false,
      updatedAt: now(),
    });
  },
  /** Seed initial users if none exist yet — uses fixed doc IDs to prevent duplicates */
  async seed(defaultPin: string): Promise<void> {
    const users: Array<Omit<AdminUser, 'id'> & { docId: string }> = [
      { docId: 'user_pavan',   username: 'pavan',   displayName: 'Pavan',   role: 'owner', pin: defaultPin, mustChangePin: false, createdAt: now(), updatedAt: now() },
      { docId: 'user_pallavi', username: 'pallavi', displayName: 'Pallavi', role: 'owner', pin: defaultPin, mustChangePin: true,  createdAt: now(), updatedAt: now() },
    ];
    for (const { docId, ...data } of users) {
      const ref = doc(db, COLLECTIONS.ADMIN_USERS, docId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, data);
      }
    }
  },
};

export const settingsService = {
  async getPin(): Promise<string> {
    const docSnap = await getDoc(doc(db, COLLECTIONS.SETTINGS, "admin"));
    if (!docSnap.exists()) return "1234";
    return (docSnap.data().pin as string) || "1234";
  },
  async setPin(pin: string): Promise<void> {
    await setDoc(doc(db, COLLECTIONS.SETTINGS, "admin"), { pin }, { merge: true });
  },
};

// ─── Admin Activity Log ───────────────────────────────────────────────────────
export const activityService = {
  async log(
    type: AdminActionType,
    label: string,
    entityId?: string,
    entityLabel?: string,
  ): Promise<void> {
    await addDoc(collection(db, COLLECTIONS.ADMIN_ACTIVITY), {
      type,
      label,
      entityId: entityId ?? null,
      entityLabel: entityLabel ?? null,
      createdAt: now(),
    });
  },
  subscribe(cb: (items: AdminAction[]) => void): Unsubscribe {
    // order by createdAt desc, last 50 docs
    return onSnapshot(
      query(collection(db, COLLECTIONS.ADMIN_ACTIVITY)),
      snap => {
        const items = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as AdminAction))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 50);
        cb(items);
      },
    );
  },
};
