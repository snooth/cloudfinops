// Hand-rolled AUD baselines — last resort when catalog + snapshot miss a SKU.

const FALLBACK_PRICES = {
  vm: {
    Standard_D2s_v5: 120.5,
    Standard_D4s_v5: 241.0,
    Standard_D8s_v5: 482.0,
    Standard_D16s_v5: 964.0,
    Standard_D32s_v5: 1928.0,
    Standard_E4s_v5: 302.0,
    Standard_E8s_v5: 604.0,
    Standard_E16s_v5: 1208.0,
    Standard_NC6s_v3: 1850.0,
    Standard_M16ts: 4200.0,
    Standard_M32ts: 8400.0,
    Standard_M64ts: 16800.0,
  },
  storage: {
    premium_ssd: 0.195,
    standard_ssd: 0.115,
    standard_hdd: 0.048,
    hot_blob: 0.028,
    cool_blob: 0.012,
    ultra_ssd: 0.32,
  },
  aks_control_plane: { standard: 0 },
  aro_control_plane: { standard: 0.571 },
  load_balancer: { standard: 38.5 },
  app_gateway: { WAF_v2: 280.0, WAF_v2_large: 520.0 },
  managed_cache: { Standard_C1: 95.0 },
  managed_service: {
    azure_ml_basic: 0,
    event_hubs_standard_2tu: 165.0,
    cosmos_400ru: 38.0,
    front_door_standard: 48.0,
  },
  license: {
    cdp_private_cloud_base: 8500.0,
    cloudera_cds_node: 1200.0,
    sql_enterprise_8core: 3200.0,
    sql_standard_core: 180.0,
    openshift_per_core: 85.0,
    neo4j_enterprise_core: 450.0,
    alation_enterprise: 6500.0,
    infoarchive_tb: 45.0,
    powerbi_pro_user: 15.0,
    powerbi_premium_capacity: 8500.0,
    rds_cal_user: 12.0,
    hashicorp_client: 8.0,
    erwin_modeler_seat: 220.0,
    gitlab_premium_user: 38.0,
    sap_s4hana_cloud_private: 45000.0,
  },
  network: {
    egress_gb: 0.115,
  },
};

const VM_SKU_MAP = {
  Standard_D2s_v5: 'D2s v5',
  Standard_D4s_v5: 'D4s v5',
  Standard_D8s_v5: 'D8s v5',
  Standard_D16s_v5: 'D16s v5',
  Standard_D32s_v5: 'D32s v5',
  Standard_E4s_v5: 'E4s v5',
  Standard_E8s_v5: 'E8s v5',
  Standard_E16s_v5: 'E16s v5',
  Standard_NC6s_v3: 'NC6s v3',
  Standard_M16ts: 'M16ts',
  Standard_M32ts: 'M32ts',
  Standard_M64ts: 'M64ts',
};

module.exports = { FALLBACK_PRICES, VM_SKU_MAP };
