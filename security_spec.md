# Firestore Security Rules Specification

## Data Invariants
1. Products, Categories, Hero Slides, and Settings are publicly viewable by store customers.
2. Only authenticated administrators can modify Products, Categories, Hero Slides, and Settings.
3. Customers can create Orders with strictly validated field constraints (customer name, phone, items, total amount).
4. Only administrators can view, list, update, or delete Orders.

## Security Controls
- Standard Master-Gate fallback rule rejecting unhandled collections.
- Strict property key and type validations for public mutations (Orders creation).
- ID format validation guards.
