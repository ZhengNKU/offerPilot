/**
 * 会员等级与展示辅助函数
 * 统一全站右上角下拉框、个人中心、调试台、报告页等处的会员显示逻辑
 */

export interface MembershipDisplayInfo {
  label: string;
  badgeClass: string;
  isVip: boolean;
}

export function getMembershipInfo(
  membership?: string | null,
  createdAt?: string | null
): MembershipDisplayInfo {
  const m = (membership || "").toLowerCase().trim();

  // 付费订阅会员
  if (m === "month_pro") {
    return {
      label: "月度专业版",
      badgeClass: "bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30",
      isVip: true,
    };
  }
  if (m === "month_max") {
    return {
      label: "月度至尊版",
      badgeClass: "bg-purple-50 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/30",
      isVip: true,
    };
  }
  if (m === "week_pro") {
    return {
      label: "周度进阶版",
      badgeClass: "bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30",
      isVip: true,
    };
  }
  if (m === "week_max") {
    return {
      label: "周度旗舰版",
      badgeClass: "bg-violet-50 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-500/30",
      isVip: true,
    };
  }
  if (m === "pro") {
    return {
      label: "PRO 会员",
      badgeClass: "bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30",
      isVip: true,
    };
  }
  if (m === "max") {
    return {
      label: "MAX 会员",
      badgeClass: "bg-purple-50 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/30",
      isVip: true,
    };
  }

  // 内测用户 (test)：检查是否已超过 30 天试用期
  if (m === "test") {
    if (createdAt) {
      try {
        const createdMs = new Date(createdAt).getTime();
        if (!isNaN(createdMs)) {
          const elapsedDays = (Date.now() - createdMs) / (1000 * 3600 * 24);
          if (elapsedDays >= 30) {
            return {
              label: "普通用户",
              badgeClass: "bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10",
              isVip: false,
            };
          }
        }
      } catch (e) {
        // ignore date parse error
      }
    }
    return {
      label: "内测用户",
      badgeClass: "bg-[#f3e8ff] dark:bg-purple-500/20 text-[#6b21a8] dark:text-purple-300 border border-[#e9d5ff] dark:border-purple-500/30",
      isVip: false,
    };
  }

  // 默认为普通免费用户
  return {
    label: "普通用户",
    badgeClass: "bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10",
    isVip: false,
  };
}
