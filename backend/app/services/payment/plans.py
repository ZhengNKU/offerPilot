from dataclasses import dataclass
from typing import Dict, Any, Optional

@dataclass
class PlanDefinition:
    id: str
    code: str
    name: str
    category: str  # "subscription" | "pack"
    cycle: str     # "week" | "month" | "pack"
    days: int      # 7 | 30 | 0
    price_cents: int # 金额（单位：分，例如 7490 代表 ¥74.90）
    benefits: Dict[str, int] # {"resume": int, "record": int, "audio": int, "live": int, "advisor": int}
    advisor_daily: int  # 仅 subscription 有效，如 60 或 80

ALL_PLANS: Dict[str, PlanDefinition] = {
    "WEEK_PRO": PlanDefinition(
        id="WEEK_PRO",
        code="week_pro",
        name="周度进阶版",
        category="subscription",
        cycle="week",
        days=7,
        price_cents=1890,
        benefits={"resume": 5, "record": 5, "audio": 3, "live": 30, "advisor": 60},
        advisor_daily=60,
    ),
    "WEEK_MAX": PlanDefinition(
        id="WEEK_MAX",
        code="week_max",
        name="周度旗舰版",
        category="subscription",
        cycle="week",
        days=7,
        price_cents=3390,
        benefits={"resume": 10, "record": 10, "audio": 5, "live": 60, "advisor": 80},
        advisor_daily=80,
    ),
    "MONTH_PRO": PlanDefinition(
        id="MONTH_PRO",
        code="month_pro",
        name="月度专业版",
        category="subscription",
        cycle="month",
        days=30,
        price_cents=7490,
        benefits={"resume": 30, "record": 30, "audio": 10, "live": 120, "advisor": 60},
        advisor_daily=60,
    ),
    "MONTH_MAX": PlanDefinition(
        id="MONTH_MAX",
        code="month_max",
        name="月度至尊版",
        category="subscription",
        cycle="month",
        days=30,
        price_cents=10990,
        benefits={"resume": 30, "record": 30, "audio": 20, "live": 180, "advisor": 80},
        advisor_daily=80,
    ),
    "PACK_A": PlanDefinition(
        id="PACK_A",
        code="pack_a",
        name="打包 A · 轻量试错包",
        category="pack",
        cycle="pack",
        days=0,
        price_cents=990,
        benefits={"resume": 2, "record": 2, "audio": 1, "live": 20, "advisor": 60},
        advisor_daily=0,
    ),
    "PACK_B": PlanDefinition(
        id="PACK_B",
        code="pack_b",
        name="打包 B · 灵活加油包",
        category="pack",
        cycle="pack",
        days=0,
        price_cents=1490,
        benefits={"resume": 3, "record": 3, "audio": 2, "live": 30, "advisor": 80},
        advisor_daily=0,
    ),
}

def get_plan(plan_id: str) -> Optional[PlanDefinition]:
    return ALL_PLANS.get(plan_id.upper())
