// AI 单据工作台：单据类型、字段、模板定义（前后端共用）。
// 所有单据共用一份数据（DocData），换单据类型时数据跟着走——填一次就能出整套（PI → CI/PL → 托书 → 提单 → 产地证 → 装运通知 → 证明 → 汇票）。
// 版式由 renderers.tsx 按样本固定渲染，AI 和表单都只负责填字段，所以格式不会走样。

import { integerToWords, round2 } from "@/lib/docs";

export const DOC_TYPES = ["pi", "sc", "ci", "pl", "si", "bl", "co", "sa", "bc", "bx"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const isDocType = (v: unknown): v is DocType => typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);

export type DocItem = {
  itemNo?: string;
  name?: string;
  desc?: string;
  imageUrl?: string;
  packing?: string;
  unit?: string;
  qty?: string;
  unitPrice?: string;
  cartons?: string;
  nw?: string;
  gw?: string;
  cbm?: string;
  hsCode?: string;
};
export type DocCharge = { label?: string; amount?: string };

// ── 字段 ──

export type FieldKind = "text" | "textarea" | "date" | "number" | "select";
export type FieldDef = {
  label: string;
  kind: FieldKind;
  /** 快速选择的选项（表单里显示成可点的小标签）；select 以外的字段也可以有，用来一键填入 */
  options?: readonly string[];
  placeholder?: string;
  hint?: string;
};

const PORTS_CN = ["XIAMEN, CHINA", "SHANGHAI, CHINA", "NINGBO, CHINA", "SHENZHEN, CHINA", "QINGDAO, CHINA", "GUANGZHOU, CHINA", "TIANJIN, CHINA", "FOSHAN, CHINA"];

export const CERT_PRESETS = [
  "THE GOODS SUPPLIED UNDER THIS CREDIT ARE BRAND NEW WITHOUT ANY MANUFACTURING DEFECT, QUANTITY AND QUALITY AS PER L/C TERMS.",
  "PACKING IS IN STANDARD EXPORT PACKING.",
  "COUNTRY OF ORIGIN \"CHINA\" HAS BEEN MENTIONED CLEARLY ON THE FACE OF GOODS / PACKAGES.",
  "ONE SET OF NON-NEGOTIABLE DOCUMENTS INCLUDING DETAILED PACKING LIST HAS BEEN DISPATCHED TO THE APPLICANT WITHIN 05 (FIVE) WORKING DAYS AFTER SHIPMENT BY COURIER / EMAIL.",
  "BATCH NUMBER, MANF. DATE, EXP. DATE AND COUNTRY OF ORIGIN HAVE BEEN MENTIONED OUTSIDE OF THE PACK / BODY OF EACH PACKING AND ON THE INVOICE.",
  "INSURANCE IS COVERED BY THE APPLICANT. SHIPMENT DETAILS HAVE BEEN ADVISED TO THE INSURANCE COMPANY WITHIN 10 (TEN) WORKING DAYS AFTER SHIPMENT.",
  "IMPORTER'S NAME, ADDRESS, TIN AND BIN HAVE BEEN INSCRIBED OR PRINTED IN INDELIBLE INK ON THE PACKAGES CONTAINING THE IMPORTED GOODS.",
] as const;

export const FIELDS = {
  // 卖方
  sellerName: { label: "卖方名称（英文）", kind: "text", placeholder: "XIAMEN YF MEDICAL CO., LTD." },
  sellerNameCn: { label: "卖方中文名", kind: "text", hint: "CI / PL 抬头第三行，可不填" },
  sellerAddress: { label: "卖方地址", kind: "textarea" },
  sellerTel: { label: "卖方电话", kind: "text" },
  sellerEmail: { label: "卖方邮箱", kind: "text" },
  sellerWebsite: { label: "卖方网站", kind: "text" },
  bankInfo: { label: "收款银行信息", kind: "textarea", placeholder: "BENEFICIARY BANK / SWIFT / A/C NO. / BENEFICIARY NAME / ADDRESS" },
  signer: { label: "签字人", kind: "text", hint: "签字栏下方显示" },

  // 单号与日期
  no: { label: "单据号", kind: "text", hint: "PI / 发票号 / 合同号；不填时用订单号" },
  date: { label: "单据日期", kind: "date" },
  contractNo: { label: "合同号", kind: "text" },
  jobNo: { label: "Job No.", kind: "text", hint: "PI 右上角的工单号，可不填" },
  validity: { label: "报价有效期", kind: "text", options: ["VALID FOR 15 DAYS", "VALID FOR 30 DAYS"] },

  // 信用证
  lcNo: { label: "L/C 号", kind: "text" },
  lcDate: { label: "开证日期", kind: "date" },
  issuingBank: { label: "开证行（名称 + 地址）", kind: "textarea" },
  docRemark: {
    label: "单据统一声明",
    kind: "textarea",
    hint: "L/C 要求每份单据都显示的内容（贸易术语 + AS PER PI + L/C 号 + HS 编码 + 进口商税号等），会原样印在 CI / PL / 证明 / 装运通知上",
  },

  // 买方
  buyerName: { label: "买方名称", kind: "text" },
  buyerAddress: { label: "买方地址", kind: "textarea" },
  buyerContact: { label: "买方联系人", kind: "text" },
  buyerTel: { label: "买方电话", kind: "text" },
  buyerEmail: { label: "买方邮箱", kind: "text" },
  consignee: { label: "收货人 Consignee", kind: "textarea", options: ["TO ORDER", "TO ORDER OF SHIPPER", "SAME AS BUYER"], hint: "L/C 项下一般是 TO THE ORDER OF 开证行" },
  notifyParty: { label: "通知人 Notify Party", kind: "textarea", options: ["SAME AS CONSIGNEE", "SAME AS BUYER"] },
  recipients: { label: "致（收件方）", kind: "textarea", hint: "装运通知 / 证明的 TO: 抬头，多个收件方用空行隔开" },

  // 贸易条款
  currency: { label: "币种", kind: "select", options: ["USD", "EUR", "CNY", "GBP", "JPY", "AUD", "CAD", "HKD"] },
  tradeTerm: { label: "贸易术语", kind: "select", options: ["EXW", "FOB", "FCA", "CFR", "CIF", "CPT", "CIP", "DAP", "DDP"] },
  tradePlace: { label: "术语地点", kind: "text", placeholder: "CHATTOGRAM PORT, BANGLADESH", hint: "FOB 写装运港，CFR/CIF 写目的港" },
  paymentTerm: {
    label: "付款方式",
    kind: "text",
    options: [
      "T/T 30% DEPOSIT, 70% BEFORE SHIPMENT",
      "T/T 30% DEPOSIT, 70% AGAINST B/L COPY",
      "T/T 100% IN ADVANCE",
      "L/C AT SIGHT",
      "D/P AT SIGHT",
    ],
  },
  deliveryTime: { label: "交货期", kind: "text", options: ["15 DAYS AFTER RECEIPT OF DEPOSIT", "25-30 DAYS AFTER RECEIPT OF DEPOSIT", "30 DAYS AFTER RECEIPT OF DEPOSIT"] },
  latestShipDate: { label: "最迟装运日", kind: "date" },
  partialShipment: { label: "分批装运", kind: "select", options: ["ALLOWED", "NOT ALLOWED"] },
  transhipment: { label: "转运", kind: "select", options: ["ALLOWED", "NOT ALLOWED"] },
  terms: { label: "条款", kind: "textarea", hint: "一行一条" },
  remark: { label: "备注", kind: "textarea" },

  // 运输
  shipMode: { label: "运输方式", kind: "select", options: ["BY SEA", "BY AIR", "BY EXPRESS", "BY RAIL", "BY TRUCK"] },
  loadingPort: { label: "装运港", kind: "text", options: PORTS_CN },
  dischargePort: { label: "卸货港", kind: "text" },
  destination: { label: "最终目的地", kind: "text", hint: "不填时同卸货港" },
  destCountry: { label: "目的国", kind: "text" },
  containerType: { label: "柜型 / 装运类型", kind: "text", options: ["1 X 20'GP", "1 X 40'GP", "1 X 40'HQ", "LCL", "BY EXPRESS"] },
  shippingMode: { label: "装运方式", kind: "select", options: ["CY-CY", "CY-CFS", "CFS-CY", "CFS-CFS"] },
  freightTerm: { label: "运费支付", kind: "select", options: ["FREIGHT PREPAID", "FREIGHT COLLECT"] },
  blType: { label: "提单类型", kind: "select", options: ["ORIGINAL B/L", "TELEX RELEASE", "SEAWAY BILL"] },
  forwarder: { label: "货代", kind: "text" },
  carrier: { label: "承运人 / 船公司", kind: "text" },
  bookingNo: { label: "订舱号", kind: "text" },
  blNo: { label: "提单号", kind: "text" },
  vessel: { label: "船名航次", kind: "text", placeholder: "MYD ZHANGZHOU V.2601S" },
  onBoardDate: { label: "装船日期", kind: "date" },
  eta: { label: "预计到港", kind: "date" },
  containers: { label: "柜号 / 封号", kind: "textarea", placeholder: "TCNU9032637/CX0665205/40'HQ", hint: "一行一个柜" },
  cargoReadyDate: { label: "货好时间", kind: "date" },
  pickupAddress: { label: "提货 / 装柜地址", kind: "textarea" },
  bookingContact: { label: "订舱联系人", kind: "text", hint: "姓名 / 电话 / 邮箱" },

  // 货物
  marks: { label: "唛头", kind: "textarea", options: ["N/M"] },
  goodsDesc: { label: "货物描述（整票）", kind: "textarea", hint: "提单 / 产地证 / 托书上的品名描述；不填时用明细品名拼" },
  hsCode: { label: "HS 编码", kind: "text" },
  origin: { label: "原产地", kind: "text", options: ["CHINA"] },
  packageUnit: { label: "包装单位", kind: "select", options: ["CARTONS", "PALLETS", "WOODEN CASES", "BAGS", "PACKAGES", "ROLLS"] },
  totalPackages: { label: "总件数", kind: "number", hint: "不填时按明细箱数合计" },
  totalNw: { label: "总净重（KGS）", kind: "number" },
  totalGw: { label: "总毛重（KGS）", kind: "number" },
  totalCbm: { label: "总体积（CBM）", kind: "number" },
  batchNo: { label: "批号", kind: "text" },
  manfDate: { label: "生产日期", kind: "text" },
  expDate: { label: "有效期", kind: "text" },
  packingNote: { label: "包装说明", kind: "text", options: ["PACKING: EXPORT STANDARD.", "PACKED IN CARTONS."] },

  // 证明 / 汇票 / 产地证
  certTitle: { label: "证明标题", kind: "text", options: ["CERTIFICATE", "BENEFICIARY'S CERTIFICATE"] },
  certText: { label: "证明内容", kind: "textarea", options: CERT_PRESETS, hint: "以 WE HEREBY CERTIFY THAT 开头的那句之后的内容" },
  certShowShipment: { label: "附装运明细", kind: "select", options: ["YES", "NO"], hint: "保险声明类证明要附上船名、提单号、金额等" },
  coverNote: { label: "保单号 / Cover Note", kind: "text" },
  draftTenor: { label: "汇票期限", kind: "text", options: ["AT SIGHT", "AT 30 DAYS AFTER SIGHT", "AT 60 DAYS AFTER SIGHT", "AT 90 DAYS AFTER SIGHT"] },
  payee: { label: "收款人（Pay to the order of）", kind: "text", hint: "一般是议付行" },
  drawee: { label: "付款人（To）", kind: "textarea", hint: "L/C 项下一般是开证行" },
  draftAmount: { label: "汇票金额", kind: "number", hint: "不填时等于发票总额" },
  issuePlace: { label: "签发地点", kind: "text", options: ["XIAMEN, CHINA", "SHANGHAI, CHINA", "NINGBO, CHINA", "SHENZHEN, CHINA", "GUANGZHOU, CHINA"] },
} as const satisfies Record<string, FieldDef>;

export type FieldKey = keyof typeof FIELDS;
export const FIELD_KEYS = Object.keys(FIELDS) as FieldKey[];
export const isFieldKey = (k: string): k is FieldKey => k in FIELDS;

export type DocData = Partial<Record<FieldKey, string>> & { items: DocItem[]; charges: DocCharge[] };

export const ITEM_COLS = {
  imageUrl: "图片",
  itemNo: "货号",
  name: "品名",
  desc: "描述 / 规格",
  packing: "包装",
  hsCode: "HS 编码",
  unit: "单位",
  qty: "数量",
  unitPrice: "单价",
  cartons: "箱数",
  nw: "净重 KG",
  gw: "毛重 KG",
  cbm: "体积 CBM",
} as const satisfies Record<keyof DocItem, string>;
export type ItemCol = keyof typeof ITEM_COLS;

export const UNITS = ["PCS", "SETS", "PAIRS", "UNITS", "BOXES", "CARTONS", "KGS", "TONS", "METERS", "ROLLS"] as const;

// ── 模板 ──

export type DocTemplate = {
  type: DocType;
  name: string;
  en: string;
  short: string;
  desc: string;
  groups: { title: string; fields: FieldKey[] }[];
  /** 必填字段；"items" 表示至少一行明细 */
  required: (FieldKey | "items")[];
  /** 表单显示的明细列；空数组 = 不需要明细 */
  itemCols: ItemCol[];
  charges?: boolean;
  /** 版式要点（来自样本），给 AI 当规矩，也在表单里提示 */
  rules: string[];
};

const SELLER: FieldKey[] = ["sellerName", "sellerNameCn", "sellerAddress", "sellerTel", "sellerEmail"];
const BUYER: FieldKey[] = ["buyerName", "buyerAddress", "buyerContact", "buyerTel", "buyerEmail"];
const LC: FieldKey[] = ["lcNo", "lcDate", "issuingBank", "docRemark"];

export const TEMPLATES: Record<DocType, DocTemplate> = {
  pi: {
    type: "pi",
    name: "形式发票",
    en: "PROFORMA INVOICE",
    short: "PI",
    desc: "报价确认、客户付定金、开 L/C 的依据",
    groups: [
      { title: "单据", fields: ["no", "date", "jobNo", "validity"] },
      { title: "买方", fields: BUYER },
      { title: "条款", fields: ["currency", "tradeTerm", "tradePlace", "paymentTerm", "deliveryTime", "shipMode", "loadingPort", "containerType"] },
      { title: "其他", fields: ["terms", "remark", "bankInfo", "signer"] },
      { title: "卖方", fields: [...SELLER, "sellerWebsite"] },
    ],
    required: ["no", "date", "sellerName", "buyerName", "currency", "tradeTerm", "paymentTerm", "items"],
    itemCols: ["imageUrl", "itemNo", "name", "desc", "packing", "unit", "qty", "unitPrice"],
    charges: true,
    rules: [
      "抬头：卖方英文名居中加粗，下一行地址；标题 PROFORMA INVOICE",
      "左边 TO: 买方名称、地址、联系人、电话、邮箱；右边 PI No. / Job No. / Date / Loading Port / Type（运输方式或柜型）",
      "明细列：NO. / PICTURE / PACKING / ITEM NO. / DESCRIPTION / UNITS / QTY / UNIT PRICE / AMOUNT，价格两位小数",
      "运费、快递费、折扣写成附加费用行（折扣用负数），合计行标注贸易术语，如 TOTAL FOB XIAMEN",
      "合计下方大写金额：SAY US DOLLARS ... ONLY",
      "之后依次是 Payment Term、Delivery Time、条款、收款银行信息，最后卖方 / 买方签字栏",
    ],
  },
  sc: {
    type: "sc",
    name: "销售合同",
    en: "SALES CONTRACT",
    short: "S/C",
    desc: "正式成交合同，双方签字盖章",
    groups: [
      { title: "单据", fields: ["no", "date", "issuePlace"] },
      { title: "买方", fields: BUYER },
      { title: "条款", fields: ["currency", "tradeTerm", "tradePlace", "paymentTerm", "deliveryTime", "latestShipDate", "loadingPort", "dischargePort", "partialShipment", "transhipment", "shipMode"] },
      { title: "包装与唛头", fields: ["packingNote", "marks"] },
      { title: "其他", fields: ["terms", "bankInfo", "signer"] },
      { title: "卖方", fields: SELLER },
    ],
    required: ["no", "date", "sellerName", "buyerName", "currency", "tradeTerm", "paymentTerm", "items"],
    itemCols: ["itemNo", "name", "desc", "unit", "qty", "unitPrice"],
    charges: true,
    rules: [
      "标题 SALES CONTRACT，右上 Contract No. / Date / Signed at",
      "THE SELLER 与 THE BUYER 两栏并排，各写名称、地址、电话邮箱",
      "开头一句：The undersigned Seller and Buyer have agreed to close the following transaction according to the terms and conditions stipulated below:",
      "明细表 + 合计 + 大写金额",
      "编号条款：1. Packing 2. Shipping Marks 3. Time of Shipment 4. Port of Loading & Destination 5. Partial Shipment / Transhipment 6. Terms of Payment，再接自定义条款",
      "最后卖方 / 买方签字盖章栏",
    ],
  },
  ci: {
    type: "ci",
    name: "商业发票",
    en: "COMMERCIAL INVOICE",
    short: "CI",
    desc: "报关、交单、清关用的正式发票",
    groups: [
      { title: "单据", fields: ["no", "date", "contractNo"] },
      { title: "买方", fields: ["buyerName", "buyerAddress"] },
      { title: "条款", fields: ["currency", "tradeTerm", "tradePlace", "shipMode", "loadingPort", "dischargePort"] },
      { title: "货物", fields: ["marks", "hsCode", "batchNo", "manfDate", "expDate", "origin"] },
      { title: "信用证", fields: LC },
      { title: "卖方", fields: [...SELLER, "signer"] },
    ],
    required: ["no", "date", "sellerName", "buyerName", "buyerAddress", "currency", "tradeTerm", "tradePlace", "items"],
    itemCols: ["name", "desc", "unit", "qty", "unitPrice"],
    charges: true,
    rules: [
      "抬头三行：卖方英文名（大写加粗）、英文地址、中文名；标题 COMMERCIAL INVOICE",
      "CONTRACT NO. / INVOICE NO. 一行，L/C NO. / DATE 一行，MESSRS.: 买方名称 + 地址",
      "明细列：Shipping Marks / DESCRIPTION OF GOODS / QTY / UNIT PRICE / AMOUNT，表头注明「贸易术语 + 地点（币种）」",
      "运费（FREIGHT）等单独一行，最后合计行数量、金额都要合计",
      "表下依次：BATCH NO. / MANF.DATE，单据统一声明，COUNTRY OF ORIGIN: CHINA，APPLICANT，ISSUING BANK",
      "全部大写英文；L/C 项下的品名、术语、声明要和 L/C 原文一字不差",
    ],
  },
  pl: {
    type: "pl",
    name: "装箱单",
    en: "PACKING LIST",
    short: "PL",
    desc: "每项货物的箱数、净毛重、体积",
    groups: [
      { title: "单据", fields: ["no", "date", "contractNo"] },
      { title: "买方", fields: ["buyerName", "buyerAddress"] },
      { title: "货物", fields: ["marks", "packageUnit", "packingNote", "origin", "totalPackages", "totalNw", "totalGw", "totalCbm"] },
      { title: "信用证", fields: LC },
      { title: "卖方", fields: [...SELLER, "signer"] },
    ],
    required: ["no", "date", "sellerName", "buyerName", "items"],
    itemCols: ["name", "desc", "unit", "qty", "cartons", "nw", "gw", "cbm"],
    rules: [
      "抬头与 CI 相同，标题 PACKING LIST，单号、日期、L/C 号、MESSRS 与 CI 一致",
      "明细列：Shipping Marks / DESCRIPTION OF GOODS / QTY / CTN(S) / N.W. / G.W. / MEAS.(CBM)，最后一行合计",
      "表下：包装说明（PACKING: EXPORT STANDARD.）、原产地、单据统一声明、APPLICANT、ISSUING BANK",
      "不出现单价和金额",
    ],
  },
  si: {
    type: "si",
    name: "订舱委托书",
    en: "BOOKING / SHIPPING INSTRUCTION",
    short: "托书",
    desc: "发给货代订舱的托运单",
    groups: [
      { title: "收发货人", fields: ["sellerName", "sellerAddress", "consignee", "notifyParty"] },
      { title: "订舱", fields: ["bookingNo", "forwarder", "containerType", "shippingMode", "freightTerm", "blType", "tradeTerm"] },
      { title: "航线", fields: ["vessel", "loadingPort", "dischargePort", "destination", "cargoReadyDate", "pickupAddress"] },
      { title: "货物", fields: ["marks", "goodsDesc", "totalPackages", "packageUnit", "totalGw", "totalCbm", "hsCode"] },
      { title: "其他", fields: ["remark", "bookingContact", "date"] },
    ],
    required: ["sellerName", "consignee", "notifyParty", "loadingPort", "dischargePort", "containerType", "freightTerm", "goodsDesc", "totalPackages", "totalGw", "totalCbm"],
    itemCols: [],
    rules: [
      "中英双语栏位：Shipper（发货人）/ Consignee（收货人）/ Notify Party（通知人），右侧 Booking No. / S/O No. / B/L No.",
      "柜型写成 FCL: ___ X 20'GP; ___ X 40'GP; ___ X 40'HQ 这种勾选格式，LCL 单独勾",
      "Shipping mode（CY-CY 等）、Freight terms（PREPAID / COLLECT）、Types of B/L（Original / Telex release）都是勾选项",
      "货物栏：唛头 / 件数 / 货物描述 / 毛重 / 体积；货物描述要和 L/C、发票一致",
      "下方：提货 / 装柜地址、货好时间、注意事项，右侧订舱联系人",
    ],
  },
  bl: {
    type: "bl",
    name: "提单补料",
    en: "BILL OF LADING (DRAFT)",
    short: "B/L",
    desc: "给船公司 / 货代的提单补料草稿，核对后出正本",
    groups: [
      { title: "收发货人", fields: ["sellerName", "sellerAddress", "consignee", "notifyParty"] },
      { title: "船务", fields: ["blNo", "vessel", "carrier", "loadingPort", "dischargePort", "destination", "onBoardDate", "freightTerm"] },
      { title: "货物", fields: ["marks", "containers", "goodsDesc", "totalPackages", "packageUnit", "totalGw", "totalCbm", "hsCode"] },
      { title: "其他", fields: ["remark", "issuePlace", "date"] },
    ],
    required: ["sellerName", "consignee", "notifyParty", "loadingPort", "dischargePort", "goodsDesc", "totalPackages", "packageUnit", "totalGw", "totalCbm", "freightTerm"],
    itemCols: [],
    rules: [
      "编号栏位：1.Shipper 2.Consignee 3.Notify Party 4.Pre-Carriage by 5.Place of Receipt 6.Ocean Vessel Voy No. 7.Port of Loading 8.Port of Discharge 9.Place of Delivery",
      "货物栏：Marks & Nos / Container/Seal No. | No. of Packages | Description of Goods | Gross Weight | Measurement",
      "货物描述下写 SHIPPED ON BOARD + 装船日期，运费条款 FREIGHT PREPAID / COLLECT",
      "10. 件数大写：SAY TOTAL: NINE HUNDRED AND FIFTY FIVE CARTONS ONLY.",
      "L/C 项下 Consignee 通常 TO THE ORDER OF 开证行，Notify 为申请人；描述、L/C 号、HS 编码照 L/C 原文",
    ],
  },
  co: {
    type: "co",
    name: "原产地证",
    en: "CERTIFICATE OF ORIGIN",
    short: "CO",
    desc: "一般原产地证草稿（贸促会 / 海关申领前核对用）",
    groups: [
      { title: "出口商 / 收货人", fields: ["sellerName", "sellerAddress", "buyerName", "buyerAddress"] },
      { title: "运输", fields: ["loadingPort", "dischargePort", "shipMode", "destCountry"] },
      { title: "货物", fields: ["marks", "goodsDesc", "totalPackages", "packageUnit", "hsCode"] },
      { title: "发票", fields: ["no", "date", "docRemark", "issuePlace"] },
    ],
    required: ["sellerName", "sellerAddress", "buyerName", "buyerAddress", "loadingPort", "dischargePort", "destCountry", "goodsDesc", "totalPackages", "hsCode", "no", "date"],
    itemCols: ["name", "unit", "qty"],
    rules: [
      "格子版式：1.Exporter 2.Consignee 3.Means of transport and route 4.Country / region of destination 5.For certifying authority use only",
      "6.Marks and numbers 7.Number and kind of packages; description of goods 8.H.S.Code 9.Quantity 10.Number and date of invoices",
      "第 7 栏以件数大写开头：NINE HUNDRED AND FIFTY FIVE (955) CARTONS OF ...，结尾加 ***",
      "第 3 栏：FROM 装运港 TO 目的港 BY SEA",
      "11.Declaration by the exporter（地点日期）与 12.Certification 栏",
    ],
  },
  sa: {
    type: "sa",
    name: "装运通知",
    en: "SHIPMENT ADVICE",
    short: "S/A",
    desc: "开船后通知客户 / 保险公司 / 开证行",
    groups: [
      { title: "收件方", fields: ["date", "recipients", "coverNote"] },
      { title: "船务", fields: ["carrier", "blNo", "vessel", "onBoardDate", "eta", "loadingPort", "dischargePort", "containers"] },
      { title: "货物", fields: ["no", "currency", "goodsDesc", "marks", "totalPackages", "packageUnit", "totalNw", "totalGw", "totalCbm", "origin"] },
      { title: "信用证", fields: ["lcNo", "lcDate", "issuingBank", "docRemark"] },
      { title: "卖方", fields: ["sellerName", "signer"] },
    ],
    required: ["date", "recipients", "blNo", "vessel", "onBoardDate", "loadingPort", "dischargePort", "no", "goodsDesc", "totalPackages"],
    itemCols: [],
    rules: [
      "标题 SHIPMENT ADVICE，RE: SHIPMENT ADVICE，DATE",
      "每个收件方一行 TO:（保险公司、申请人、开证行，带邮箱）",
      "逐行列出：COVER NOTE NO. / CARRIER / L/C NO. / B/L NO. / VESSEL NAME/VOY / ON BOARD DATE / ETA DESTINATION PORT / PORT OF LOADING / PORT OF DISCHARGE / INVOICE NO. / AMOUNT / CONTAINER NO. / DESCRIPTION / QUANTITY / NO. OF PACKAGES / N.W. / G.W. / SHIPPING MARK",
      "之后：原产地、单据统一声明、APPLICANT、ISSUING BANK、卖方签章",
    ],
  },
  bc: {
    type: "bc",
    name: "受益人证明",
    en: "BENEFICIARY'S CERTIFICATE",
    short: "证明",
    desc: "L/C 要求的各种 CERTIFICATE（全新、包装、产地标注、寄单、保险声明…）",
    groups: [
      { title: "证明", fields: ["certTitle", "certText", "date", "recipients", "certShowShipment", "coverNote"] },
      { title: "信用证", fields: ["no", "lcNo", "lcDate", "issuingBank", "docRemark", "buyerName", "buyerAddress", "origin"] },
      { title: "装运明细（附装运明细时）", fields: ["carrier", "blNo", "vessel", "onBoardDate", "eta", "loadingPort", "dischargePort", "containers", "goodsDesc", "totalPackages", "totalNw", "totalGw", "marks"] },
      { title: "卖方", fields: ["sellerName", "signer"] },
    ],
    required: ["certText", "date", "sellerName"],
    itemCols: [],
    rules: [
      "标题 CERTIFICATE（或 BENEFICIARY'S CERTIFICATE），正文 WE HEREBY CERTIFY THAT + 证明内容（照 L/C 46A 条款改成完成时）",
      "一张证明只写一项内容；L/C 要几项就做几张",
      "正文后：COUNTRY OF ORIGIN、单据统一声明、APPLICANT、ISSUING BANK，最后卖方名称 + 日期签章",
      "保险声明类要加 TO: 保险公司 / 申请人，并附船名、提单号、金额、件数重量等装运明细",
    ],
  },
  bx: {
    type: "bx",
    name: "汇票",
    en: "BILL OF EXCHANGE",
    short: "汇票",
    desc: "L/C / 托收交单用的汇票（一式两份）",
    groups: [
      { title: "汇票", fields: ["no", "date", "issuePlace", "currency", "draftAmount", "draftTenor", "payee", "drawee"] },
      { title: "信用证", fields: ["issuingBank", "lcNo", "lcDate"] },
      { title: "卖方", fields: ["sellerName", "signer"] },
    ],
    required: ["no", "date", "currency", "draftTenor", "payee", "drawee", "sellerName"],
    itemCols: [],
    rules: [
      "标题 BILL OF EXCHANGE，No.（发票号）、For 币种金额、地点日期",
      "At ___ sight of this FIRST of Exchange (SECOND of the same tenor and date being unpaid) Pay to the order of 议付行 the sum of 大写金额",
      "Drawn under 开证行 L/C No. ... dated ...；To: 付款人（L/C 项下为开证行）",
      "右下卖方名称 + 签字；一式两份 FIRST / SECOND",
    ],
  },
};

// ── 数据工具 ──

export const emptyDoc = (): DocData => ({ items: [], charges: [] });

const num = (v: string | undefined | null) => {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[,\s]/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
export const hasNum = (v: string | undefined | null) => !!v && /\d/.test(String(v));
export { num as parseNum };

export function lineAmount(it: DocItem) {
  return round2(num(it.qty) * num(it.unitPrice));
}

/** 金额、数量、件数、重量合计；表头填了的总数优先 */
export function totals(d: DocData) {
  const subtotal = round2(d.items.reduce((s, i) => s + lineAmount(i), 0));
  const chargesSum = round2(d.charges.reduce((s, c) => s + num(c.amount), 0));
  const sum = (k: keyof DocItem) => round2(d.items.reduce((s, i) => s + num(i[k]), 0));
  const units = [...new Set(d.items.map((i) => (i.unit || "").trim().toUpperCase()).filter(Boolean))];
  return {
    subtotal,
    total: round2(subtotal + chargesSum),
    qty: sum("qty"),
    qtyUnit: units.length === 1 ? units[0] : units.length ? "" : "PCS",
    packages: hasNum(d.totalPackages) ? num(d.totalPackages) : sum("cartons"),
    nw: hasNum(d.totalNw) ? num(d.totalNw) : sum("nw"),
    gw: hasNum(d.totalGw) ? num(d.totalGw) : sum("gw"),
    cbm: hasNum(d.totalCbm) ? num(d.totalCbm) : round2(d.items.reduce((s, i) => s + num(i.cbm), 0) * 1000) / 1000,
  };
}

/** 整票货物描述：没填就用明细品名拼 */
export function goodsDescription(d: DocData) {
  if (d.goodsDesc?.trim()) return d.goodsDesc.trim();
  const names = [...new Set(d.items.map((i) => (i.name || "").trim()).filter(Boolean))];
  return names.join(", ").toUpperCase();
}

/** NINE HUNDRED AND FIFTY FIVE (955) CARTONS */
export function packagesInWords(n: number, unit = "CARTONS") {
  if (!n) return "";
  return `${integerToWords(Math.round(n)).replace(/-/g, " ")} (${Math.round(n)}) ${unit}`;
}

const isEmpty = (d: DocData, k: FieldKey | "items") => {
  if (k === "items") return !d.items.some((i) => i.name?.trim() || i.desc?.trim());
  if (k === "totalPackages") return !totals(d).packages;
  if (k === "totalGw") return !totals(d).gw;
  if (k === "totalCbm") return !totals(d).cbm;
  if (k === "goodsDesc") return !goodsDescription(d);
  return !d[k]?.trim();
};

/** 当前类型还缺哪些必填项 */
export function missingFields(type: DocType, d: DocData) {
  return TEMPLATES[type].required.filter((k) => isEmpty(d, k));
}

export const fieldLabel = (k: FieldKey | "items") => (k === "items" ? "产品明细" : FIELDS[k].label);

// ── 合并补丁（AI 和表单共用，前后端结果一致） ──

export type DocPatch = {
  set?: Partial<Record<string, unknown>>;
  items?: unknown;
  charges?: unknown;
};

const str = (v: unknown, max = 4000) => (v == null ? "" : String(v).slice(0, max));

function cleanItems(v: unknown): DocItem[] | null {
  if (!Array.isArray(v)) return null;
  return v.slice(0, 200).map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const it: DocItem = {};
    for (const k of Object.keys(ITEM_COLS) as ItemCol[]) if (r[k] != null && r[k] !== "") it[k] = str(r[k], 2000);
    return it;
  });
}

function cleanCharges(v: unknown): DocCharge[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .slice(0, 20)
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      return { label: str(r.label, 200), amount: str(r.amount, 40) };
    })
    .filter((c) => c.label || c.amount);
}

export function applyPatch(d: DocData, p: DocPatch): DocData {
  const next: DocData = { ...d, items: d.items, charges: d.charges };
  for (const [k, v] of Object.entries(p.set ?? {})) {
    if (!isFieldKey(k)) continue;
    const s = str(v).trim();
    if (s) next[k] = s;
    else delete next[k];
  }
  const items = cleanItems(p.items);
  if (items) next.items = items;
  const charges = cleanCharges(p.charges);
  if (charges) next.charges = charges;
  return next;
}

/** 从任意 JSON 还原成 DocData（读库、接收前端传来的数据时用） */
export function normalizeDoc(v: unknown): DocData {
  const r = (v ?? {}) as Record<string, unknown>;
  const set: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) if (typeof r[k] === "string") set[k] = r[k];
  return applyPatch(emptyDoc(), { set, items: r.items ?? [], charges: r.charges ?? [] });
}

/** 单据文件名 / 标题：CI YF2604-188 - REJIMED */
export function docTitle(type: DocType, d: DocData) {
  const t = TEMPLATES[type];
  const no = d.no || d.blNo || d.contractNo || "";
  return [t.short, no, d.buyerName ? `- ${d.buyerName.split(/[,\n]/)[0].slice(0, 40)}` : ""].filter(Boolean).join(" ");
}

// ── 日期 ──

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "2026-11-11" → upper: NOV.11,2026；en: Nov 11, 2026；不是 ISO 日期就原样返回 */
export function fmtDate(v: string | undefined, style: "upper" | "en" = "upper") {
  if (!v) return "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  if (!m) return v;
  const [, y, mo, da] = m;
  const mon = MONTHS[Number(mo) - 1];
  if (!mon) return v;
  const dd = da.padStart(2, "0");
  return style === "upper" ? `${mon}.${dd},${y}` : `${mon[0]}${mon.slice(1).toLowerCase()} ${dd}, ${y}`;
}
