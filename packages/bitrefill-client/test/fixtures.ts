/**
 * Fixtures copied verbatim from Bitrefill's own PUBLISHED DOCUMENTATION
 * EXAMPLES (not a live API response - no credentials were available when
 * this client was built, see verification-matrix.md). Sources:
 *   - https://docs.bitrefill.com/reference/get_products-esims-id.md
 *   - https://docs.bitrefill.com/reference/post_esims.md
 * These must be re-validated against a real response once an API key is
 * available - see bitrefill-integration.md's updated verification note.
 */

export const DOC_EXAMPLE_ESIM_PRODUCT_DETAIL_RESPONSE = {
  meta: { id: "test-esim", _endpoint: "/products/test-esim" },
  data: {
    id: "test-gift-card-link",
    name: "Test Gift Card Link",
    country_code: "KN",
    country_name: "St Kitts and Nevis",
    currency: "USD",
    created_time: "2021-10-04T17:02:22.768Z",
    recipient_type: "none",
    image: "https://res.cloudinary.com/bitrefill/d_operator.png/this_is_a_test",
    in_stock: true,
    packages: {
      id: "test-gift-card-link<&>10",
      value: 10,
      price: 12,
    },
    range: {
      min: 10,
      max: 100,
      step: 10,
      price_rate: 1.2,
    },
  },
};

export const DOC_EXAMPLE_ESIM_PRODUCT_WITH_ARRAY_PACKAGES = {
  meta: {},
  data: {
    id: "bitrefill-esim-japan",
    name: "Japan eSIM",
    currency: "USD",
    packages: [
      { package_id: "bitrefill-esim-japan<&>5gb", value: "5GB, 30 Days", price: 12.5 },
      { package_id: "bitrefill-esim-japan<&>10gb", value: "10GB, 30 Days", price: 19.99 },
    ],
  },
};

/**
 * A product LIST response (`data` is an array) - per
 * https://docs.bitrefill.com/docs/searching-products:
 * "const { data: products } = await response.json();"
 * Wraps the same single product as DOC_EXAMPLE_ESIM_PRODUCT_WITH_ARRAY_PACKAGES
 * in a list envelope, since search/list endpoints return arrays while the
 * single-product detail endpoint returns one object - these are genuinely
 * different envelopes, not interchangeable fixtures.
 */
export const DOC_EXAMPLE_ESIM_PRODUCT_LIST_RESPONSE = {
  meta: {},
  data: [DOC_EXAMPLE_ESIM_PRODUCT_WITH_ARRAY_PACKAGES.data],
};

export const DOC_EXAMPLE_ESIM_INVOICE_RESPONSE = {
  meta: {
    products: [{ product_id: "test-esim", value: "1GB, 7 Days", quantity: 1 }],
    payment_method: "balance",
    auto_pay: false,
    _endpoint: "/esims",
  },
  data: {
    id: "c2b27180-610e-4132-af77-ad42fc0ac444",
    created_time: "2021-10-04T17:12:02.142Z",
    completed_time: "2021-10-04T17:12:11.990Z",
    status: "not_delivered",
    user: { id: "613b62204ef8b621bdb47539", email: "test@bitrefill.com" },
    payment: {
      method: "balance",
      address: "bc1qthrlhrdtk8vv7p25cmwat87kg7ezfjglrx5xyr",
      currency: "USD",
      price: 10,
      status: "unpaid",
      commission: 0.0001,
    },
    orders: [
      {
        id: "615b35e2f616a8092ee45aff",
        status: "created",
        product: {
          id: "test-esim",
          name: "Test Gift Card Code",
          value: "10",
          currency: "USD",
          image: "https://res.cloudinary.com/bitrefill/d_operator.png/this_is_a_test",
          _href: "https://api-bitrefill.com/2/products/test-esim",
        },
        created_time: "2021-10-04T17:12:02.101Z",
        delivered_time: "2021-10-04T17:12:11.990Z",
      },
    ],
  },
};

export const DOC_EXAMPLE_ERROR_RESPONSE = {
  error_code: "missing_param",
  message: "Missing required parameter: product_id",
};
