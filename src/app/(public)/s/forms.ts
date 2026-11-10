/** 发给客户填写的表单（英文，客户是海外买家） */
export type ShareField = { name: string; label: string; required?: boolean; type?: "text" | "email" | "tel" | "textarea"; placeholder?: string };

type ShareFormDef = { title: string; intro: string; zh: string; fields: ShareField[] };

export const SHARE_FORMS: { inquiry: ShareFormDef; shipping: ShareFormDef } = {
  inquiry: {
    title: "Product Inquiry",
    intro: "Tell us what you need and we will send you our best offer shortly.",
    zh: "询价表单",
    fields: [
      { name: "name", label: "Your name", required: true },
      { name: "company", label: "Company" },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "country", label: "Country / Region" },
      { name: "products", label: "Products & specifications", type: "textarea", required: true, placeholder: "Model, size, color, packaging…" },
      { name: "quantity", label: "Quantity" },
      { name: "targetPrice", label: "Target price" },
      { name: "port", label: "Destination port" },
      { name: "message", label: "Other requirements", type: "textarea" },
    ],
  },
  shipping: {
    title: "Shipping Information",
    intro: "Please confirm the consignee details so we can prepare the shipping documents.",
    zh: "收货信息表单",
    fields: [
      { name: "consignee", label: "Consignee company", required: true },
      { name: "contact", label: "Contact person", required: true },
      { name: "phone", label: "Phone", type: "tel", required: true },
      { name: "email", label: "Email", type: "email" },
      { name: "address", label: "Full address", type: "textarea", required: true },
      { name: "country", label: "Country / Region", required: true },
      { name: "port", label: "Destination port" },
      { name: "notify", label: "Notify party", type: "textarea" },
      { name: "taxId", label: "Tax ID / VAT / Importer No." },
      { name: "message", label: "Remarks", type: "textarea" },
    ],
  },
};

export type ShareFormKind = keyof typeof SHARE_FORMS;
