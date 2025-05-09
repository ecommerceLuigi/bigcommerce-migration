# BigCommerce Migration Script

This script duplicates brands, categories, and products from a source BigCommerce store to a destination store, runs nightly at 1am UTC, and sends email logs via Resend. It is designed to be hosted on Render.

## Prerequisites
- Node.js 18+
- BigCommerce API tokens for source and destination stores (scopes: products, categories, brands)
- Resend account and API key
- Render account

## Setup
1. **Clone the repository**:
   ```bash
   git clone <your-repo-url>
   cd bigcommerce-migration
