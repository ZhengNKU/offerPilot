"""
公司梯队分级（4 级）。

- Tier 1（顶流大厂）
- Tier 2（一线中厂）
- Tier 3（其他互联网/科技公司）
- Tier 4（未知 / 无公司）

Tier 1、Tier 2 名单来自 F:\match_algorithm.md 设计文档。
"""

from typing import Optional

# ── Tier 1：顶流大厂 ──
_COMPANY_TIER_1: set[str] = {
    "腾讯", "腾讯控股", "Tencent",
    "阿里", "阿里巴巴", "Alibaba", "淘宝", "天猫", "蚂蚁", "蚂蚁集团", "Ant Group",
    "字节", "字节跳动", "ByteDance", "抖音", "TikTok",
    "百度", "Baidu",
    "美团", "Meituan",
    "华为", "Huawei",
    "拼多多", "Pinduoduo",
    "京东", "JD", "Jingdong",
    "Google", "谷歌",
    "Apple", "苹果",
    "Meta", "Facebook",
    "Amazon", "亚马逊",
    "Microsoft", "微软",
}

# ── Tier 2：一线中厂 ──
_COMPANY_TIER_2: set[str] = {
    "网易", "NetEase",
    "小米", "Xiaomi",
    "滴滴", "滴滴出行", "DiDi",
    "快手", "Kuaishou",
    "携程", "Ctrip", "Trip.com",
    "B站", "bilibili", "哔哩哔哩",
    "小红书", "Xiaohongshu",
    "360", "奇虎360",
    "新浪", "Sina", "微博", "Weibo",
    "联想", "Lenovo",
    "大疆", "DJI",
    "商汤", "商汤科技", "SenseTime",
    "Shopee",
    "Zoom",
    "唯品会",
    "搜狐", "Sohu",
    "爱奇艺", "iQIYI",
    "搜狗", "Sogou",
    "完美世界",
    "陌陌", "挚文集团",
    "知乎",
    "虎牙",
    "斗鱼",
    "贝壳", "贝壳找房",
    "猿辅导",
    "作业帮",
    "跟谁学", "高途",
    "VIPKID",
    "旷视", "Megvii",
    "依图",
    "云从",
    "地平线",
    "小鹏", "小鹏汽车",
    "蔚来", "NIO",
    "理想", "理想汽车",
    "BYD", "比亚迪",
    "宁德时代", "CATL",
}


def _fuzzy_contains(name: str, keywords: str) -> bool:
    """检查 name 是否包含任意关键词（英文不区分大小写）。"""
    name_lower = name.lower()
    for kw in keywords.replace("，", ",").split(","):
        kw = kw.strip()
        if kw and kw.lower() in name_lower:
            return True
    return False


def get_company_tier(company_name: Optional[str]) -> int:
    """
    返回公司梯队：1（顶流）| 2（一线）| 3（其他科技公司）| 4（未知/无）。

    使用精确匹配 + 模糊包含双重策略，兼容简称、英文名等变体。
    """
    if not company_name or not company_name.strip():
        return 4

    name = company_name.strip()

    # ── 精确匹配 ──
    if name in _COMPANY_TIER_1:
        return 1
    if name in _COMPANY_TIER_2:
        return 2

    # ── 模糊匹配（Tier 1 关键词优先） ──
    TIER1_KEYWORDS = (
        "腾讯,Tencent,阿里,Alibaba,字节,ByteDance,抖音,百度,Baidu,美团,Meituan,"
        "华为,Huawei,拼多多,Pinduoduo,京东,JD,蚂蚁,Ant,Google,谷歌,"
        "Apple,苹果,Meta,Facebook,Amazon,亚马逊,Microsoft,微软,蚂蚁集团"
    )
    TIER2_KEYWORDS = (
        "网易,NetEase,小米,Xiaomi,滴滴,DiDi,快手,Kuaishou,携程,"
        "B站,bilibili,哔哩哔哩,小红书,360,奇虎,新浪,微博,联想,Lenovo,大疆,DJI,"
        "商汤,SenseTime,Shopee,Zoom,唯品会,搜狐,爱奇艺,搜狗,完美世界,"
        "陌陌,知乎,虎牙,斗鱼,贝壳,猿辅导,作业帮,高途,VIPKID,"
        "旷视,Megvii,依图,云从,地平线,小鹏,蔚来,NIO,理想,"
        "比亚迪,BYD,宁德时代,CATL,携程,跟谁学"
    )

    if _fuzzy_contains(name, TIER1_KEYWORDS):
        return 1
    if _fuzzy_contains(name, TIER2_KEYWORDS):
        return 2

    # ── Tier 3：有公司名但不在知名名单 → 普通科技公司 ──
    return 3
