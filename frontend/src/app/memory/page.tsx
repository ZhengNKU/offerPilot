"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, UserMenu } from "@/components/AuthProvider";
import GrowthCurveChart, { type GrowthPoint } from "@/components/GrowthCurveChart";
import CounselorPanel from "@/components/counselor/CounselorPanel";
import {
  listSessions as listCounselorSessions,
  getSession as getCounselorSessionDetail,
  deleteSession as deleteCounselorSession,
  getCounselorStats,
  type SessionListItem as CounselorSessionListItem,
  type MessageItem as CounselorMessageItem,
  type CounselorStats as CounselorStatsData,
} from "@/lib/counselorClient";

interface SessionHistoryItem {
  id: string;
  date: string;
  type: "audio" | "text" | "resume" | "live";
  liveId?: number;       // PR6: 模拟面试的 live_id，用于详情页跳转
  title: string;
  score: number;
  grade: string;
  company: string;
  role: string;
  round: string;
  details: string;
  raw_created_at?: string;
}

interface ProjectMemoryItem {
  id: number;
  project_name: string;
  summary: string;
  description: string | null;
  category: string;
  sub_tags: string[];
  tech_stack: string[];
  metrics: Record<string, any>;
  role: string | null;
  team_size: number | null;
  duration: string | null;
  mastery_level: number;
  mention_count: number;
  last_mentioned_at: string | null;
  last_mentioned_session_id: number | null;
  last_mentioned_summary: string | null;
  importance: number;
  source_type: string;
  version: number;
  last_updated_by: string;
  created_at: string | null;
  updated_at: string | null;
}

interface SubAbility {
  id: number;
  name: string;
  sort_order: number;
  question_count: number;
}

interface CoreAbility {
  id: number;
  name: string;
  sort_order: number;
  sub_abilities: SubAbility[];
}

interface KnowledgeMeta {
  generated_at: string | null;
  from_role: string | null;
  from_years: string | null;
  from_grade: string | null;
}

function formatRelativeTime(dateStr: string) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 30) return `${diffDays}天前`;
    return d.toLocaleDateString();
  } catch (e) {
    return dateStr;
  }
}

const buildPageList = (cur: number, total: number): (number | "…")[] => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  const start = Math.max(2, cur - 2);
  const end = Math.min(total - 1, cur + 2);
  if (start > 2) pages.push("…");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("…");
  pages.push(total);
  return pages;
};

const KNOWLEDGE_QUESTIONS_MAP: Record<string, Array<{
  title: string;
  freq: number;
  aiAnswer: {
    core: string;
    s: string;
    t: string;
    a: string[];
    r: string;
    keyPoints: string[];
    followUps: string[];
  }
}>> = {
  "Redis 缓存穿透与击穿": [
    {
      title: "什么是缓存穿透？生产环境如何进行防御与兜底？",
      freq: 14,
      aiAnswer: {
        core: "缓存穿透是指查询一个数据库中和缓存中均不存在的数据，每次请求都直接打入数据库。生产环境核心防御手段为布隆过滤器前置拦截，并配合空值缓存与参数强校验。",
        s: "在秒杀促销期间，系统遭受大量恶意扫描或由于爬虫脚本发起不合法的空商品 ID 访问，致使底层 MySQL 连接池被打满、QPS 陡增，面临雪崩风险。",
        t: "前置校验过滤这些无效的访问流，并以微小系统资源占用代价将穿透访问挡在数据库之外，保障主库连接稳定性。",
        a: [
          "在 API 网关及应用层入口，引入布隆过滤器（Bloom Filter）缓存所有有效的数据 ID，凡不存在的 Key 直接在内存中被拦截并返回空。",
          "针对数据库查询 Miss 的请求，将对应的 Key 缓存为一个空值对象（如 Null）或特定标识，且设置 30-60 秒的极短生存周期（TTL）以防止数据积压。",
          "对入参 ID 进行正则或强格式验证，过滤明显不规范的入参（如负数 ID 或乱码字符）。"
        ],
        r: "成功拦截了 99.9% 以上的穿透与攻击性流量，主库 QPS 曲线重归平缓，CPU 使用率降低 85%，数据库安全稳健。",
        keyPoints: [
          "布隆过滤器占用空间极小但存在极低概率误判率",
          "缓存空值能有效拦截短期高频重复穿透请求",
          "参数校验拦截能够提前削减 30% 基础垃圾流量"
        ],
        followUps: [
          "布隆过滤器的误判率如何根据业务体量平衡调优？",
          "缓存空值可能导致内存无谓积压，应如何结合 LRU 进行缓存管理？"
        ]
      }
    },
    {
      title: "什么是缓存击穿？与缓存雪崩有什么本质区别？",
      freq: 12,
      aiAnswer: {
        core: "缓存击穿指单个被极高频访问的热点 Key 突然过期失效，瞬时海量请求直达主库；缓存雪崩则是大规模缓存 Key 批量失效或缓存服务停机导致系统崩溃。",
        s: "微博爆款热搜或突发的明星事件，对应热点新闻的缓存 Key 刚好到期失效，同时有数十万并发试图重入加载该内容。",
        t: "防止失效瞬间发生多路数据库连接抢占和慢查询，提供温和重构数据、平滑加载的保护方案。",
        a: [
          "在查询数据库重建缓存的代码段加入分布式互斥锁（如 Redis setnx），仅允许首个获取锁的线程查询数据库重建，其他线程等待重试。",
          "对最核心的爆款热点 Key，采用物理上‘永不过期’的设计，转而由后台常驻守护线程异步在即将逻辑过期前重新预热加载新数据。"
        ],
        r: "实现热点数据平滑过渡无缝续期，彻底规避了高并发瞬间主库的过载，防线固若金汤。",
        keyPoints: [
          "击穿关注点是个体核心 Key，雪崩关注面是批量失效",
          "互斥锁可保障绝对的一致性但会带来一定的 RT 损耗",
          "异步看门狗预热机制是目前业界推荐的主流高吞吐解耦架构"
        ],
        followUps: [
          "如果分布式锁在获取时产生死锁或超时该怎么处理？",
          "如何在运行时实时发现系统的潜在“热点 Key”以自动防范击穿？"
        ]
      }
    },
    {
      title: "如何设计一个大流量下的热点 Key 探测与缓存机制？",
      freq: 10,
      aiAnswer: {
        core: "热点 Key 探测常基于客户端收集（如 Redisson 拦截器）、服务端代理层分析或 Redis monitor 命令采样，结合本地多级缓存。",
        s: "电商秒杀业务中某些网红店铺或单品访问量超日常百倍，导致 Redis 对应分片网卡被打满、请求队列积压。",
        t: "实时检测出秒级突发的超限高频 Key，并在节点崩溃前自动分摊流量。",
        a: [
          "引入开源监控组件（如 JVM 内存计数器或 Sentinel），对 Redis 操作进行拦截打点统计。",
          "检测到 Hot Key 后，通过配置中心将热点数据广播并推送至本地业务服务的本地多级缓存（Caffeine）。",
          "在 Redis 集群端为热点 Key 增加随机哈希后缀（如 key_01, key_02），将单点访问分散至各个节点。"
        ],
        r: "热点检测延迟控制在 1秒以内，本地缓存成功拦截了 80% 的热点读操作，彻底防止了 Redis 单分片雪崩。",
        keyPoints: ["探测方案需对业务入侵小、系统开销低", "本地多级缓存可极大分摊 Redis 带宽瓶颈", "加随机后缀打散写/读是简单有效的数据扩容方案"],
        followUps: ["本地缓存的数据一致性如何保障？", "配置中心推送的延迟在极端环境下如何优化？"]
      }
    },
    {
      title: "如何处理布隆过滤器的重建和扩容问题？",
      freq: 9,
      aiAnswer: {
        core: "布隆过滤器位图一旦初始化其长度和哈希函数数量就固定了。如果数据量暴增，需要进行双过滤器热切换重建或建立过滤链。",
        s: "平台从百万级商品迅速扩充至千万级，导致原预估 1% 误判率 of 布隆过滤器误判率狂飙至 25%，失去大部分拦截效力。",
        t: "不停止在线业务的前提下，动态且平滑地为过滤器进行高精度升级扩容。",
        a: [
          "启动后台离线任务，基于最新全量数据在一个全新的、容量更大的备用布隆过滤器 B 中构建索引。",
          "实时流量写入时同时写 A 和 B。待 B 初始化完成后，将前端网关配置切换，正式指引向 B 过滤器，并销毁旧的 A 过滤器。"
        ],
        r: "拦截精度重回 99.9% 级别，热切换全过程零停机，无任何请求异常或主库慢查询阻碍。",
        keyPoints: [
          "过滤器本身大小不可动态变更，必须做整体重构",
          "双布隆过滤器并行双写是安全迁移的关键保障",
          "初始化读库阶段需做限流以防止抢占正常业务带宽"
        ],
        followUps: [
          "如何支持带有动态删除操作的“布隆计数过滤器”（Counting Bloom Filter）？",
          "数据同步重建期间发生的数据变更如何实现最终一致？"
        ]
      }
    },
    {
      title: "高并发场景下，布隆过滤器的哈希碰撞如何降低？",
      freq: 8,
      aiAnswer: {
        core: "哈希碰撞概率由哈希函数的个数（k）和位数组长度（m）共同决定。通过调整这两个参数可使碰撞概率逼近数学下限。",
        s: "安全防护模块面临极其庞大的恶性请求，需要设计拦截策略，将拦截误判率控制在百万分之一以下。",
        t: "寻找最符合内存预算与误判率边界的最佳哈希映射模型参数。",
        a: [
          "利用 MurmurHash 等非加密型高性能散列算法，生成分布极度均匀的二进制索引。",
          "通过数学推导模型得到当误判率为 p 时最佳的 m 和 k 分配数值，并用 Lua 脚本封装多次位图操作减少网络 RTT。"
        ],
        r: "碰撞几率控制在 0.0001% 水平，用极低的位图内存消耗（仅需几十MB）成功阻断了全量外部扫库的请求攻击。",
        keyPoints: ["哈希次数越多误判越低，但计算开销越大", "MurmurHash 在防碰撞和吞吐量中是最佳折中", "Lua 脚本批量位操作可以减少 Redis 网络消耗"],
        followUps: ["如何测试布隆过滤器的哈希分布均匀度？", "位图如果突破 Redis 单 Key 512MB 限制如何处理？"]
      }
    },
    {
      title: "布隆过滤器和缓存空值，在选择上有什么最佳考量？",
      freq: 7,
      aiAnswer: {
        core: "布隆过滤器适合拦截规律或不规律的、超大规模且数据极其稀疏的空 Key 请求；缓存空值更适合经常重复访问的少量无效 Key。",
        s: "用户主页查询存在海量空白账户的黑产注册或注销请求，需要在两种方案中做架构选型评估。",
        t: "根据具体的数据量级、内存开销以及业务演进，确定最佳方案组合。",
        a: [
          "对于防扫库攻击等超大量恶意扫描请求，首选布隆过滤器（内存消耗恒定且极小）。",
          "对于新老用户查询的日常常规空数据（重复率较高），使用缓存空值（开发简单、维护低成本）。"
        ],
        r: "完成了系统防刷功能的重构，在拦截百万恶意流量的前提下，Redis 的内存开销下降了 90%。",
        keyPoints: ["布隆过滤器占用空间极小，但存在一定误判率", "缓存空值逻辑简单但量大占用内存", "推荐组合使用：过滤器拦截黑产扫描，空值处理日常偶发"],
        followUps: ["如何识别出特定请求是恶意攻击还是偶发错误？", "如果业务需要频繁增删数据，应该使用哪种方案？"]
      }
    },
    {
      title: "如果布隆过滤器误判了，将一个不存在的 Key 判为存在，如何兜底？",
      freq: 6,
      aiAnswer: {
        core: "由于布隆过滤器存在低概率误判，部分请求会穿透到数据库。此时应搭配数据库防刷限制、慢查询熔断与缓存空值进行多重兜底。",
        s: "秒杀系统偶尔发生由于误判导致流量直接打到 MySQL，产生慢 SQL 堵塞数据库连接池。",
        t: "设计容错兜底漏斗，防止误判漏网的请求雪崩式地压瘫主库。",
        a: [
          "在底层数据库连接池及服务限流器上配置针对单一 IP 或 API 的并发阈值限制。",
          "在读库操作发生 Miss 之后，立刻以较低的过期时间（例如5秒）写回 Redis 缓存空值，终结后续相同请求的重入。",
          "通过 sentinel 配置数据库慢查询熔断，一旦延迟过高，自动返回友好空白或降级静态页面。"
        ],
        r: "主库面对漏网流量表现平稳，连接数依然保持在安全水平，未产生系统性阻塞事件。",
        keyPoints: ["系统设计必须承认物理局限（误判），并进行防御设计", "漏斗模型在系统架构中是绝对的最佳实践", "读 Miss 后立刻缓存空值是拦截的黄金策略"],
        followUps: ["数据库 Miss 后的写回操作如何保证高可靠？", "如何对穿透数据库的漏网流量进行打点监控？"]
      }
    },
    {
      title: "Redis 缓存空值，如果产生大量空缓存如何避免内存占满？",
      freq: 6,
      aiAnswer: {
        core: "可以通过设置随机的、极短的过期时间，并利用 LRU 或 LFU 内存淘汰策略，加之前置黑白名单校验来降低空缓存积压。",
        s: "接口被暴力扫描，缓存空值机制导致 Redis 在 10分钟内生成了 500万个空缓存 Key，可用内存告警。",
        t: "既保留空缓存的高并发拦截效果，又保证 Redis 的内存维持在健康线以下。",
        a: [
          "将空缓存的过期时间统一设置为随机值（如 15 - 30 秒），让无效 Key 能够快速过期释放空间。",
          "在 Redis.conf 配置文件中设置 maxmemory 上限，并采用 volatile-lru 淘汰算法，优先清理有过期时间的空 Key。"
        ],
        r: "无效空 Key 的生命周期被缩短，Redis 内存峰值下降了 70%，内存使用率始终稳定在 65% 以下。",
        keyPoints: ["过期时间设随机值可防缓存同时失效雪崩", "LRU/LFU 内存淘汰提供了最后一层物理兜底", "大量空缓存表明需要前置黑白名单及限流拦截"],
        followUps: ["如何配置 volatile-lru 并进行性能实测？", "Redis 内存不足时有哪些紧急收缩技巧？"]
      }
    },
    {
      title: "缓存一致性在缓存穿透与击穿的场景下，怎么做到最终一致？",
      freq: 5,
      aiAnswer: {
        core: "一般使用 Cache Aside 模式，即：读取时先读缓存再读库；更新时先写库再删缓存。针对击穿，还应在更新完库后自动刷新热点 Key 并重设 TTL。",
        s: "在高并发写、高并发读的订单支付场景中，数据由于高频更新出现缓存与数据库数据不一致，导致用户界面出现历史脏数据。",
        t: "确保数据库与 Redis 之间的数据差异在百毫秒内完成收敛并达到最终一致。",
        a: [
          "引入 Canal 监听 MySQL binlog 日志，以异步队列形式向 Redis 推送数据失效或更新指令。",
          "在修改商品库存等写操作中，采用“先写库，后删缓存”的最佳实践，并配备 Redis 延迟双删脚本兜底。",
          "给写命令添加分布式互斥锁，防止高并发写与击穿重建的并发冲突。"
        ],
        r: "脏数据残留时延从 10秒缩短到了 50毫秒以内，并发场景下的一致性验证全部通过。",
        keyPoints: ["Cache Aside 是互联网分布式架构的最基础与核心标准", "延迟双删有助于清理解析时差导致的并发脏数据", "监听 binlog 是解耦写业务与缓存更新的工业级方案"],
        followUps: ["延迟双删中，第二次删除的延迟时间如何精准测定？", "Canal 挂掉时，有何种补偿机制来保证一致性？"]
      }
    },
    {
      title: "如何处理大量缓存同时过期时的雪崩应对问题？",
      freq: 5,
      aiAnswer: {
        core: "通过给大批缓存 Key 设置分散的、随机的过期时间偏移，配置多级缓存，并在 Redis 集群崩溃时应用限流和降级熔断方案。",
        s: "由于线上系统每天零点进行大批活动上线，导致大量商品缓存刚好在零点后 1小时（即1点）集中失效，MySQL 连接池瞬时被打满导致响应超时。",
        t: "使缓存过期时间变得离散均匀，消除缓存失效产生的波峰流量。",
        a: [
          "在缓存写入模块中为基础 TTL 增加随机数偏移（例如 base_ttl + random(1, 10) * 60），将失效波峰彻底打散。",
          "在微服务集群内加入本地缓存（Guava/Caffeine）做二级防护，防止单点故障引发全局崩塌。"
        ],
        r: "零点期间主库 QPS 曲线趋于平滑，再未发生因为大批量缓存同时过期带来的数据库连接堵塞故障。",
        keyPoints: ["加入随机扰动是防御雪崩最简单高效的良方", "多级缓存（二级本地缓存）大大分摊了单点压力", "核心场景下必须有熔断降级（Hystrix/Sentinel）保障韧性"],
        followUps: ["如何合理规划多级缓存各层级的过期时间比率？", "网关限流算法在雪崩发生时如何平滑起效？"]
      }
    }
  ],
  "Redis 分布式锁原理": [
    {
      title: "Redis 实现分布式锁的正确姿势是什么？核心命令有哪些？",
      freq: 12,
      aiAnswer: {
        core: "正确姿势是使用具有 NX PX 参数的 SET 命令实现加锁的原子性，并结合 Lua 脚本校验客户端唯一标识（如 UUID）来实现安全释放。",
        s: "分布式集群下的多副本订单扣减，若采用 SETNX + EXPIRE，可能在执行锁失效命令前节点宕机，产生死锁。",
        t: "实现具备防死锁、独占性及原子释放特性的分布式锁方案。",
        a: [
          "加锁：使用 SET lock_key client_uuid NX PX 30000 将获取锁与设置生命周期原子化绑定。",
          "开锁：编写 Lua 脚本对比当前 Key 对应的 value 是否等于加锁时的 client_uuid，若相同则调用 del 删除该 Key。"
        ],
        r: "彻底杜绝了锁被其他客户端误删及死锁故障，高并发环境下锁性能稳定。",
        keyPoints: ["SET NX PX 组合是解决设置过期时间原子性的标准命令", "UUID 唯一性判定是防止锁被误解锁的安全红线", "Lua 脚本保证解锁时校验与删除的原子执行"],
        followUps: ["Lua 脚本在 Redis 集群模式下的插槽约束是什么？", "主从异步复制导致的锁失效问题如何预防？"]
      }
    },
    {
      title: "什么是分布式锁的续期问题？Redisson 的看门狗机制是如何运作的？",
      freq: 10,
      aiAnswer: {
        core: "看门狗机制是针对持锁线程任务执行过长、导致锁过期提前释放的自动续期方案。当线程持锁未释放时，定期延长锁过期时间。",
        s: "复杂的数据处理逻辑因网络延迟耗时 45秒，但锁的过期时间仅 30秒，中途锁失效导致其他进程重入抢占。",
        t: "动态自动续期分布式锁，且保障节点宕机时依然能解锁防死锁。",
        a: [
          "Redisson 锁在加锁成功且未指定超时时间时，会自动开启一个后台看门狗定时任务（默认每隔 10秒）。",
          "该任务不断检测持锁线程是否存活，若存活则向 Redis 发送续期指令延长过期时间为 30秒。"
        ],
        r: "业务执行过长期间未发生锁中途流失，且宕机节点在 30秒内锁自动正常过期释放。",
        keyPoints: ["看门狗机制提供了无感的长锁生命周期自适应", "续期频率通常为超时时间的 1/3", "宕机看门狗心跳停止自动防止长锁变死锁"],
        followUps: ["JVM 全局 Full GC 导致看门狗心跳丢失该怎么避免死锁？", "如何对分布式锁进行精细的锁争用时长监控？"]
      }
    }
  ]
};

const getQuestionsForKnowledge = (name: string): Array<{
  title: string;
  freq: number;
  aiAnswer: {
    core: string;
    s: string;
    t: string;
    a: string[];
    r: string;
    keyPoints: string[];
    followUps: string[];
  }
}> => {
  if (KNOWLEDGE_QUESTIONS_MAP[name]) {
    return KNOWLEDGE_QUESTIONS_MAP[name];
  }
  
  // Dynamic fallback generator for other knowledge items
  const fallbackList = [];
  const templates = [
    `如何理解 ${name} 的核心机制与底层原理？`,
    `在高并发高吞吐场景下，${name} 可能会有哪些严重的性能瓶颈？`,
    `详细谈谈 ${name} 发生状态不一致或数据偏差时的解决策略。`,
    `如何对生产部署环境中的 ${name} 进行监控与核心指标调优？`,
    `${name} 的故障排查指南：当系统响应时间剧增或发生 OOM 时如何快速定位？`,
    `分布式架构下，针对 ${name} 的多活高可用设计如何落地？`,
    `${name} 在业务核心链路设计中的并发数据幂等性保护。`,
    `${name} 的底层源码设计细节：例如核心数据结构与并发加锁机制。`,
    `${name} 与同类技术选型（如 ZooKeeper, Consul, MySQL）的优劣对比。`,
    `在容器化与 Kubernetes 云原生环境下，如何对 ${name} 进行伸缩和治理？`
  ];
  
  const freqs = [17, 15, 12, 10, 9, 8, 8, 6, 6, 5];
  
  for (let i = 0; i < 10; i++) {
    fallbackList.push({
      title: templates[i],
      freq: freqs[i],
      aiAnswer: {
        core: `${name} 是该技术栈中最核心的构件之一，在秒级高并发、大规模数据计算以及微服务架构中提供了不可或缺的状态流转和数据读写防护屏障。其性能调优往往需要在一致性与延迟之间作取舍。`,
        s: `在系统流量持续上涨、业务逻辑变得极其复杂的场景下，单点读写或单库存储模式难以为继，必须对 ${name} 做出精细的架构设计。`,
        t: `实现一个具备极高可用性、极强容灾弹性且在高峰大促期间吞吐稳定的 ${name} 实战方案。`,
        a: [
          `分析业务并发度，分片存储或使用本地多级缓存，减轻单节点连接占用和带宽负荷。`,
          `在核心层代码设置互斥防护或分布式协调，防止数据状态产生竞态冲突或重入问题。`,
          `配置全面的 Prometheus 指标监控大盘，针对连接数、系统资源占用和超时配置预警。`
        ],
        r: `系统最大 QPS 负载能力成功翻倍，平稳扛过多次生产环境大流量压测，且无任何数据偏差产生。`,
        keyPoints: [
          `熟悉该机制的底层执行模型与线程竞争机制`,
          `结合系统可用性指标合理微调超时和重试参数`,
          `在故障发生时应具备降级、限流与熔断防雪崩方案`
        ],
        followUps: [
          `在发生极短暂的网络通信抖动时，如何做客户端自适应重试？`,
          `该组件如何实现热升级以及零宕机不停机的数据无缝迁移？`
        ]
      }
    });
  }
  
  return fallbackList;
};

export default function CareerMemoryDashboard() {
  const router = useRouter();
  const auth = useAuth();

  // Active tab management: overview, timeline, projects, knowledge, weaknesses, growth, advisor
  const [activeTab, setActiveTab] = useState("overview");

  // AI 职业顾问 (Counselor) Lifted State
  const [counselorSessions, setCounselorSessions] = useState<CounselorSessionListItem[]>([]);
  const [counselorSessionId, setCounselorSessionId] = useState<number | null>(null);
  const [counselorMessages, setCounselorMessages] = useState<CounselorMessageItem[]>([]);
  const [counselorInput, setCounselorInput] = useState("");
  const [counselorStreaming, setCounselorStreaming] = useState(false);
  const [counselorPending, setCounselorPending] = useState<any | null>(null);
  const [counselorRemaining, setCounselorRemaining] = useState<number | null>(null);
  const [counselorStats, setCounselorStats] = useState<CounselorStatsData | null>(null);
  // 每次 askAdvisor 触发时 +1，作为 <CounselorPanel key=...> 强制重挂载以清理旧会话状态
  const [counselorSessionKey, setCounselorSessionKey] = useState(0);
  const [isLoadingCounselorStats, setIsLoadingCounselorStats] = useState(false);
  const [counselorPage, setCounselorPage] = useState(1);
  const [counselorSessionsTotal, setCounselorSessionsTotal] = useState(0);
  const [counselorAutoSendPrompt, setCounselorAutoSendPrompt] = useState<string | null>(null);

  // Load counselor sessions list with pagination
  const loadCounselorSessions = useCallback(async (page = 1) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
    if (!auth.isLoggedIn || !token) {
      setCounselorSessions([]);
      setCounselorSessionsTotal(0);
      return;
    }
    try {
      const limit = COUNSELOR_PAGE_SIZE;
      const offset = (page - 1) * limit;
      const r = await listCounselorSessions(limit, offset);
      setCounselorSessions(r.sessions);
      setCounselorSessionsTotal(r.total);
    } catch (e) {
      console.error("load counselor sessions failed:", e);
    }
  }, [auth.isLoggedIn]);

  // Load counselor session detail
  const loadCounselorSession = useCallback(async (sid: number) => {
    try {
      const r = await getCounselorSessionDetail(sid);
      setCounselorMessages(r.session.messages as CounselorMessageItem[]);
      setCounselorSessionId(sid);
      setCounselorPending(null);
    } catch (e) {
      console.error("load counselor session failed:", e);
    }
  }, []);

  // Start new session
  const newCounselorSession = useCallback(() => {
    setCounselorSessionId(null);
    setCounselorMessages([]);
    setCounselorPending(null);
  }, []);

  const askAdvisor = useCallback((promptText: string) => {
    // 直接 push 到 CounselorPanel 的 autoSendPrompt prop，触发其 useEffect 立即发送
    // （用 state 而不是 localStorage，避免刷新时机与 SSR 不一致的问题）
    newCounselorSession();
    setActiveTab("advisor");
    // 重挂 CounselorPanel 清掉旧会话上下文；新挂载 + autoSendPrompt prop 即可触发首问
    setCounselorSessionKey(k => k + 1);
    setCounselorAutoSendPrompt(promptText);
  }, [newCounselorSession]);

  // Delete counselor session
  const handleDeleteCounselorSession = useCallback((sid: number) => {
    setDeleteTarget(`counselor-${sid}`);
    setShowConfirmModal(true);
  }, []);

  const [selectedCounselorIds, setSelectedCounselorIds] = useState<number[]>([]);

  // Delete selected counselor sessions in batch
  const handleDeleteCounselorSessionBatch = useCallback(() => {
    if (selectedCounselorIds.length === 0) return;
    setDeleteTarget("counselor-batch");
    setShowConfirmModal(true);
  }, [selectedCounselorIds.length]);

  // Fetch counselor statistics
  const fetchCounselorStats = useCallback(async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
    if (!auth.isLoggedIn || !token) {
      setCounselorStats(null);
      return;
    }
    setIsLoadingCounselorStats(true);
    try {
      const stats = await getCounselorStats();
      setCounselorStats(stats);
    } catch (e) {
      console.error("fetch counselor stats failed:", e);
    } finally {
      setIsLoadingCounselorStats(false);
    }
  }, [auth.isLoggedIn]);

  const [advisorInsights, setAdvisorInsights] = useState<{
    focus_areas: string[];
    interview_trends: string[];
    recommended_actions: string[];
    career_suggestions: string[];
    is_customized: boolean;
    target_role?: string;
    updated_at?: string | null;
    status?: string;
  } | null>(null);
  const [isLoadingAdvisorInsights, setIsLoadingAdvisorInsights] = useState(false);

  const fetchAdvisorInsights = useCallback(async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
    if (!auth.isLoggedIn || !token) {
      setAdvisorInsights(null);
      return;
    }
    setIsLoadingAdvisorInsights(true);
    try {
      const res = await fetch("http://localhost:8001/api/counselor/advisor-insights", {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setAdvisorInsights(data);
      }
    } catch (e) {
      console.error("fetch advisor insights failed:", e);
    } finally {
      setIsLoadingAdvisorInsights(false);
    }
  }, [auth.isLoggedIn]);

  // 当处于 AI 建议生成中状态时，开启每 3 秒一次的自动轮询拉取
  useEffect(() => {
    if (!advisorInsights || advisorInsights.status !== "generating" || !auth.isLoggedIn) {
      return;
    }
    const timer = setTimeout(() => {
      fetchAdvisorInsights();
    }, 3000);
    return () => clearTimeout(timer);
  }, [advisorInsights?.status, fetchAdvisorInsights, auth.isLoggedIn]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab) {
        setActiveTab(tab);
      }
    }
  }, []);

  const handleTabChange = (tab: string, resetSession: boolean = false) => {
    setActiveTab(tab);
    if (tab === "advisor" && resetSession) {
      newCounselorSession();
    }
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.pushState(null, "", url.toString());
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
    }
  }, [activeTab]);

  const [searchQuery, setSearchQuery] = useState("");
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeOfferIdx, setActiveOfferIdx] = useState<number | null>(null);
  const [searchSidebarQuery, setSearchSidebarQuery] = useState("");
  const [activeTimelineFilter, setActiveTimelineFilter] = useState("all");
  // 时间轴分页：每页 10 条，filter/search 变更时自动回到第 1 页
  const TIMELINE_PAGE_SIZE = 10;
  const [timelinePage, setTimelinePage] = useState(1);
  // 职业顾问会话分页：与后端 /api/counselor/sessions 默认 limit 对齐
  const COUNSELOR_PAGE_SIZE = 10;

  const [historyItems, setHistoryItems] = useState<SessionHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // 能力成长曲线
  const [growthPoints, setGrowthPoints] = useState<GrowthPoint[]>([]);
  const [growthAxisLabels, setGrowthAxisLabels] = useState<(number | null)[]>([]);
  const [growthTotal, setGrowthTotal] = useState(0);
  const [isLoadingGrowth, setIsLoadingGrowth] = useState(false);
  const [growthMode, setGrowthMode] = useState<"recent" | "all">("recent");

  // Offer 概率预测
  const [offerTrendPoints, setOfferTrendPoints] = useState<any[]>([]);
  const [offerCurrentProb, setOfferCurrentProb] = useState<number | null>(null);
  const [offerTotalSessions, setOfferTotalSessions] = useState(0);
  const [offerSuggestion, setOfferSuggestion] = useState<{
    focus_areas: string[];
    potential_probability: number;
  } | null>(null);
  const [isLoadingOfferTrend, setIsLoadingOfferTrend] = useState(false);
  const [offerMode, setOfferMode] = useState<"recent" | "all">("recent");

  // Offer 概率折线图展示数据（跟随模式过滤）
  const displayOfferData = useMemo(() => {
    const rawTotal = offerTrendPoints.length;
    const isRecent = offerMode === "recent";
    const points = isRecent ? offerTrendPoints.slice(-6) : offerTrendPoints;
    const displayCount = points.length;
    // X 轴范围：最近六次模式不足 6 条时强制展示 6 个刻度位置
    const xMax = isRecent && rawTotal < 6 ? 6 : displayCount;
    // X 轴可见标签
    let labelIndices: number[];
    if (isRecent) {
      labelIndices = Array.from({ length: xMax }, (_, i) => i + 1);
    } else {
      labelIndices = xMax > 1 ? [1, xMax] : [1];
    }
    return { points, displayCount, xMax, labelIndices, rawTotal };
  }, [offerMode, offerTrendPoints]);

  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    setAvatarError(false);
  }, [auth.user.avatar]);

  // New deletion states
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | "batch" | null>(null);

  // Knowledge Base details modal states
  const [selectedKnowledge, setSelectedKnowledge] = useState<{ cat: string; name: string; c: number; m: number } | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [selectedQuestionIdx, setSelectedQuestionIdx] = useState(0);

  const openKnowledgeModal = useCallback((cat: string, name: string, c: number, m: number) => {
    setSelectedKnowledge({ cat, name, c, m });
    setKnowledgeLoading(true);
    setSelectedQuestionIdx(0);
    setTimeout(() => {
      setKnowledgeLoading(false);
    }, 600);
  }, []);

  const closeKnowledgeModal = useCallback(() => {
    setSelectedKnowledge(null);
    setKnowledgeLoading(false);
  }, []);

  // Knowledge Base dynamic data from API
  const [knowledgeAbilities, setKnowledgeAbilities] = useState<CoreAbility[]>([]);
  const [knowledgeMeta, setKnowledgeMeta] = useState<KnowledgeMeta>({
    generated_at: null,
    from_role: null,
    from_years: null,
    from_grade: null,
  });
  const [isLoadingAbilities, setIsLoadingAbilities] = useState(false);

  const fetchKnowledgeAbilities = useCallback(async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
    if (!auth.isLoggedIn || !token) return;
    setIsLoadingAbilities(true);
    try {
      const res = await fetch("http://localhost:8001/api/memory/knowledge/abilities", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setKnowledgeAbilities(data.abilities || []);
        setKnowledgeMeta({
          generated_at: data.generated_at,
          from_role: data.from_role,
          from_years: data.from_years,
          from_grade: data.from_grade,
        });
      }
    } catch (e) {
      console.error("fetch knowledge abilities failed:", e);
    } finally {
      setIsLoadingAbilities(false);
    }
  }, [auth.isLoggedIn]);

  // Knowledge tab visible → fetch
  useEffect(() => {
    if (activeTab === "knowledge") {
      fetchKnowledgeAbilities();
    }
  }, [activeTab, fetchKnowledgeAbilities]);

  // Project memory state
  const [projects, setProjects] = useState<ProjectMemoryItem[]>([]);
  const [projectTotal, setProjectTotal] = useState(0);
  const [projectCategories, setProjectCategories] = useState<{ tag_name: string; tag_key: string; color_class?: string }[][]>([[], []]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);

  const handleDeleteProject = (projectId: number) => {
    handleDeleteClick(`project-${projectId}`);
  };

  const fetchSessions = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
    if (!auth.isLoggedIn || !token) {
      setHistoryItems([]);
      return;
    }
    setIsLoadingHistory(true);
    try {
      const headers: Record<string, string> = {
        "Authorization": `Bearer ${token}`
      };

      // 1. Fetch audio sessions
      const audioRes = await fetch("http://localhost:8001/api/audio/sessions", { headers });
      let audioItems: any[] = [];
      if (audioRes.status === 401) {
        localStorage.removeItem("interviewVar_token");
        auth.logout();
        return;
      }
      if (audioRes.ok) {
        audioItems = await audioRes.json();
      }

      // 2. Fetch resume analyses
      const resumeRes = await fetch("http://localhost:8001/api/resume/analyses", { headers });
      let resumeRawItems: any[] = [];
      if (resumeRes.ok) {
        const resumeData = await resumeRes.json();
        resumeRawItems = resumeData.items || [];
      }

      // 2.5 PR6: Fetch live sessions（模拟面试）
      const liveRes = await fetch("http://localhost:8001/api/live/sessions-list/history", { headers });
      let liveRawItems: any[] = [];
      if (liveRes.ok) {
        liveRawItems = await liveRes.json();
      }

      // 3. Map audio sessions
      const mappedAudio = audioItems.map((session: any) => {
        let dateStr = "06-01 14:32";
        if (session.created_at) {
          const d = new Date(session.created_at);
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const hh = String(d.getHours()).padStart(2, '0');
          const min = String(d.getMinutes()).padStart(2, '0');
          dateStr = `${mm}-${dd} ${hh}:${min}`;
        }

        // 直接用后端返回的结构化字段，不再解析 title
        const company = session.company || "";
        const role = session.role || (session.audio_url === "text_mode" ? "面试记录" : "录音分析");
        const round = session.round || "";
        const displayTitle = session.display_title
          || [company, role, round].filter(Boolean).join(" · ")
          || "未命名面试分析";

        let grade = "待提升候选人";
        if (session.ipi_score >= 80) grade = "优秀候选人";
        else if (session.ipi_score >= 70) grade = "中级候选人";

        return {
          id: String(session.id),
          date: dateStr,
          raw_created_at: session.created_at || "",
          type: (session.audio_url === "text_mode" ? "text" : "audio") as "audio" | "text",
          title: displayTitle,
          score: session.ipi_score || 0,
          grade,
          company,
          role,
          round,
          details: session.executive_summary || "暂无详细摘要信息。"
        };
      });

      // 4. Map resume analyses
      const mappedResume = resumeRawItems.map((ra: any) => {
        let dateStr = "06-01 14:32";
        if (ra.created_at) {
          const d = new Date(ra.created_at);
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const hh = String(d.getHours()).padStart(2, '0');
          const min = String(d.getMinutes()).padStart(2, '0');
          dateStr = `${mm}-${dd} ${hh}:${min}`;
        }

        let grade = "待提升简历";
        if (ra.score >= 85) grade = "优秀简历";
        else if (ra.score >= 70) grade = "良好简历";

        return {
          id: String(ra.id),
          date: dateStr,
          raw_created_at: ra.created_at || "",
          type: "resume" as const,
          title: `简历优化 · ${ra.filename || "简历"}`,
          score: ra.score || 0,
          grade,
          company: "个人简历",
          role: ra.filename || "未知岗位",
          round: "简历深度分析",
          details: `大厂 ATS 机器人通过率 ${ra.ats_pass_rate || 0}%。简历优化前评分 ${ra.score || 0}分，AI 预计优化后可提升至 ${ra.optimized_score || 0}分。`
        };
      });

      // 4.5 PR6: Map live sessions（模拟面试）
      const mappedLive = liveRawItems.map((l: any) => {
        let dateStr = "06-01 14:32";
        if (l.created_at) {
          const d = new Date(l.created_at);
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const hh = String(d.getHours()).padStart(2, '0');
          const min = String(d.getMinutes()).padStart(2, '0');
          dateStr = `${mm}-${dd} ${hh}:${min}`;
        }

        const interviewTypeLabel: Record<string, string> = {
          tech_8gu: "技术面·八股",
          tech_project: "技术面·项目",
          tech_scenario: "技术面·场景",
          hr_comprehensive: "HR面",
        };
        const difficultyLabel: Record<string, string> = {
          Lv1: "友善", Lv2: "偏友好", Lv3: "有压力", Lv4: "严苟",
        };
        const role = interviewTypeLabel[l.interview_type] || "实时模拟";
        const round = difficultyLabel[l.difficulty] || l.difficulty || "—";
        const durMin = Math.round((l.duration_sec || 0) / 60);

        return {
          id: String(l.session_id || l.id),  // 用 session_id 优先（报告页用），fallback 到 live_id
          liveId: l.id,                       // PR6: 保留 liveId 用于详情页 URL
          date: dateStr,
          raw_created_at: l.created_at || "",
          type: "live" as const,
          title: `实时模拟面试 · ${l.target_role || '面试'}`,
          score: 0,                            // 报告生成后会被 report 页填充；这里先给 0
          grade: (
            {
              created: "等待开始",
              ws_connecting: "连接中",
              live: "进行中",
              ending: "正在结束",
              ended: "已结束",
              analyzing: "分析中",
              completed: "已完成",
              failed: "评估失败"
            } as Record<string, string>
          )[l.status] || "未知状态",
          company: l.company_style || "—",
          role,
          round: `${durMin > 0 ? durMin + "分钟 · " : ""}${round}`,
          details: `${role} · ${round}${durMin > 0 ? " · 实际时长 " + durMin + " 分钟" : ""}${l.persona_cn ? " · " + l.persona_cn : ""}`,
        };
      });

      // 5. Merge and sort by raw_created_at descending
      const combined = [...mappedAudio, ...mappedLive, ...mappedResume].sort((a, b) => {
        const dateA = a.raw_created_at ? new Date(a.raw_created_at).getTime() : 0;
        const dateB = b.raw_created_at ? new Date(b.raw_created_at).getTime() : 0;
        return dateB - dateA;
      });

      setHistoryItems(combined);
    } catch (err) {
      console.error("Failed to fetch history sessions:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const fetchGrowthCurve = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
    if (!auth.isLoggedIn || !token) {
      setGrowthPoints([]);
      setGrowthAxisLabels([]);
      setGrowthTotal(0);
      return;
    }
    setIsLoadingGrowth(true);
    try {
      const res = await fetch("http://localhost:8001/api/memory/growth-curve", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setGrowthPoints(data.points || []);
        setGrowthAxisLabels(data.axis_labels || []);
        setGrowthTotal(data.total_analyses || 0);
      }
    } catch (err) {
      console.error("Failed to fetch growth curve:", err);
    } finally {
      setIsLoadingGrowth(false);
    }
  };

  const handleGrowthPointClick = useCallback((point: GrowthPoint) => {
    // 先写 localStorage（与 handleViewDetails 保持一致），确保目标页加载正确的面试详情
    localStorage.setItem("interviewVar_report_mode", point.type);
    localStorage.setItem("interviewVar_session_id", String(point.session_id));
    // 直接读后端返回的结构化字段；title 不再参与数据解析
    localStorage.setItem("interviewVar_session_company", ((point as any).company as string) || "");
    localStorage.setItem("interviewVar_session_role", ((point as any).role as string) || "");
    localStorage.setItem("interviewVar_session_round", ((point as any).round as string) || "");
    localStorage.setItem(
      "interviewVar_session_date",
      ((point as any).date as string) || (point.analysis_time ? point.analysis_time.split("T")[0] : "")
    );
    localStorage.setItem("interviewVar_viewing_session", "true");
    localStorage.removeItem("interviewVar_task_id");

    if (point.type === "audio") {
      router.push(`/debugger/voice?sessionId=${point.session_id}`);
    } else {
      router.push(`/debugger/record?sessionId=${point.session_id}`);
    }
  }, [router]);

  const fetchOfferTrend = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
    if (!auth.isLoggedIn || !token) {
      setOfferTrendPoints([]);
      setOfferCurrentProb(null);
      setOfferTotalSessions(0);
      setOfferSuggestion(null);
      return;
    }
    setIsLoadingOfferTrend(true);
    try {
      const res = await fetch("http://localhost:8001/api/live/offer-trend", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setOfferTrendPoints(data.points || []);
        setOfferCurrentProb(data.current_probability ?? null);
        setOfferTotalSessions(data.total_sessions || 0);
        setOfferSuggestion(data.suggestion || null);
      }
    } catch (err) {
      console.error("Failed to fetch offer trend:", err);
    } finally {
      setIsLoadingOfferTrend(false);
    }
  };

  const fetchProjects = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
    if (!auth.isLoggedIn || !token) {
      setProjects([]);
      setProjectTotal(0);
      return;
    }
    setIsLoadingProjects(true);
    setProjectsError(null);
    try {
      const headers: Record<string, string> = {
        "Authorization": `Bearer ${token}`
      };

      // Fetch projects list (sorted by importance, up to 100)
      const res = await fetch(
        "http://localhost:8001/api/memory/projects?sort=importance&limit=100&offset=0",
        { headers }
      );
      if (res.status === 401) {
        localStorage.removeItem("interviewVar_token");
        auth.logout();
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "获取项目记忆失败");
      }
      const data = await res.json();
      setProjects(data.projects || []);
      setProjectTotal(data.total || 0);

      // Fetch tags (no auth required per backend)
      try {
        const tagsRes = await fetch("http://localhost:8001/api/memory/projects/tags");
        if (tagsRes.ok) {
          const tagsData = await tagsRes.json();
          setProjectCategories([tagsData.categories || [], tagsData.sub_tags || []]);
        }
      } catch (tagErr) {
        console.error("Failed to fetch project tags:", tagErr);
      }
    } catch (err: any) {
      console.error("Failed to fetch project memory:", err);
      setProjectsError(err.message || "加载项目记忆失败");
      auth.triggerToast("项目记忆加载失败，请刷新重试");
    } finally {
      setIsLoadingProjects(false);
    }
  };

  useEffect(() => {
    fetchSessions();
    fetchProjects();
    fetchGrowthCurve();
    fetchOfferTrend();

    const handleStorageChange = () => {
      fetchSessions();
      fetchProjects();
      fetchGrowthCurve();
      fetchOfferTrend();
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [auth.isLoggedIn]);

  // 切换到总览看板时，刷新项目、分析趋势及AI顾问意见；切换到项目记忆库 Tab 时刷新项目
  useEffect(() => {
    if (activeTab === "overview" && auth.isLoggedIn) {
      fetchProjects();
      fetchGrowthCurve();
      fetchOfferTrend();
      fetchAdvisorInsights();
    } else if (activeTab === "projects") {
      fetchProjects();
    }
  }, [activeTab, auth.isLoggedIn, fetchAdvisorInsights]);

  // 加载 AI 职业顾问数据
  useEffect(() => {
    if (auth.isLoggedIn) {
      loadCounselorSessions(counselorPage);
      fetchCounselorStats();
      fetchAdvisorInsights();
    }
  }, [auth.isLoggedIn, counselorPage, loadCounselorSessions, fetchCounselorStats, fetchAdvisorInsights]);

  const handleInterceptAction = () => {
    setShowLoginModal(true);
  };

  const handleViewDetails = (item: SessionHistoryItem) => {
    localStorage.setItem("interviewVar_report_mode", item.type);
    localStorage.setItem("interviewVar_session_company", item.company);
    localStorage.setItem("interviewVar_session_role", item.role);
    localStorage.setItem("interviewVar_session_years", "3-5年");
    localStorage.setItem("interviewVar_session_round", item.round);
    localStorage.setItem("interviewVar_session_date", item.date.split(" ")[0]);
    localStorage.setItem("interviewVar_session_grade", item.type === "resume" ? "L8 / P7" : "P6");
    localStorage.setItem("interviewVar_session_salary", item.type === "resume" ? "35K-45K" : "35-40K");
    localStorage.setItem("interviewVar_viewing_session", "true");
    localStorage.setItem("interviewVar_session_id", item.id);
    localStorage.removeItem("interviewVar_task_id");
    
    if (item.type === "audio") {
      router.push("/debugger/voice");
    } else if (item.type === "text") {
      router.push("/debugger/record");
    } else if (item.type === "resume") {
      router.push(`/debugger/resume?id=${item.id}`);
    } else if (item.type === "live") {
      router.push(`/training?liveId=${item.liveId}`);
    } else {
      router.push("/debugger/report");
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      setSelectedIds(prev => {
        const unique = new Set([...prev, ...visibleIds]);
        return Array.from(unique);
      });
    }
  };

  const handleDeleteClick = (target: string | "batch") => {
    setDeleteTarget(target);
    setShowConfirmModal(true);
  };

  const handleDeleteConfirm = async () => {
    setShowConfirmModal(false);
    setIsDeleting(true);
    
    try {
      const token = localStorage.getItem("interviewVar_token");
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      if (deleteTarget && typeof deleteTarget === "string" && deleteTarget.startsWith("project-")) {
        const projId = parseInt(deleteTarget.replace("project-", ""), 10);
        const res = await fetch(`http://localhost:8001/api/memory/projects/${projId}`, {
          method: "DELETE",
          headers
        });
        if (res.ok) {
          auth.triggerToast("项目记忆删除成功");
          await fetchProjects();
        } else {
          const errData = await res.json().catch(() => ({}));
          auth.triggerToast(errData.detail || "删除失败");
        }
      } else if (deleteTarget === "batch") {
        // Find which selected IDs are audio, resume, and live
        const audioSessionIds: number[] = [];
        const resumeAnalysisIds: number[] = [];
        const liveIds: number[] = [];

        selectedIds.forEach(id => {
          const item = historyItems.find(x => x.id === id);
          if (item) {
            if (item.type === "resume") {
              resumeAnalysisIds.push(Number(id));
            } else if (item.type === "live") {
              // PR6: 实时面试用 liveId 删（item.id 是 session_id，未归档时为 undefined）
              if (item.liveId) liveIds.push(item.liveId);
            } else {
              audioSessionIds.push(Number(id));
            }
          }
        });

        // Delete audio sessions in batch
        if (audioSessionIds.length > 0) {
          const res = await fetch("http://localhost:8001/api/audio/sessions/batch-delete", {
            method: "POST",
            headers,
            body: JSON.stringify({ session_ids: audioSessionIds })
          });
          if (!res.ok) {
            const errData = await res.json();
            auth.triggerToast(errData.detail || "语音会话批量删除失败");
          }
        }

        // Delete resume sessions in parallel
        if (resumeAnalysisIds.length > 0) {
          const deletePromises = resumeAnalysisIds.map(id =>
            fetch(`http://localhost:8001/api/resume/analyses/${id}`, {
              method: "DELETE",
              headers
            })
          );
          await Promise.all(deletePromises);
        }

        // Delete live sessions in batch
        if (liveIds.length > 0) {
          const res = await fetch("http://localhost:8001/api/live/sessions/batch-delete", {
            method: "POST",
            headers,
            body: JSON.stringify({ live_ids: liveIds })
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            auth.triggerToast(errData.detail || "实时面试批量删除失败");
          } else {
            const data = await res.json().catch(() => ({}));
            if (data.skipped_count > 0) {
              auth.triggerToast(`已删除 ${data.deleted_count} 条，跳过 ${data.skipped_count} 条无权限记录`);
            }
          }
        }

        setSelectedIds([]);
        await fetchSessions();
      } else if (deleteTarget === "counselor-batch") {
        try {
          const deletePromises = selectedCounselorIds.map(sid => deleteCounselorSession(sid));
          await Promise.all(deletePromises);
          auth.triggerToast("批量删除成功");
          setSelectedCounselorIds([]);

          // Determine target page after batch delete
          let targetPage = counselorPage;
          const remainingItems = counselorSessions.length - selectedCounselorIds.length;
          if (remainingItems <= 0 && counselorPage > 1) {
            targetPage = counselorPage - 1;
            setCounselorPage(targetPage);
          }
          await loadCounselorSessions(targetPage);

          // Refresh stats
          const stats = await getCounselorStats();
          setCounselorStats(stats);

          // Reset active session if it was deleted
          if (selectedCounselorIds.includes(counselorSessionId || 0)) {
            newCounselorSession();
          }
        } catch (e: any) {
          auth.triggerToast("批量删除失败：" + e.message);
        }
      } else if (typeof deleteTarget === "string" && deleteTarget.startsWith("counselor-")) {
        const sid = parseInt(deleteTarget.replace("counselor-", ""), 10);
        try {
          await deleteCounselorSession(sid);
          if (counselorSessionId === sid) {
            newCounselorSession();
          }
          // If deleting the last item on the page, go to the previous page
          let targetPage = counselorPage;
          if (counselorSessions.length === 1 && counselorPage > 1) {
            targetPage = counselorPage - 1;
            setCounselorPage(targetPage);
          }
          await loadCounselorSessions(targetPage);
          // Refresh stats
          const stats = await getCounselorStats();
          setCounselorStats(stats);
        } catch (e: any) {
          auth.triggerToast("删除失败：" + e.message);
        }
      } else if (deleteTarget) {
        const item = historyItems.find(x => x.id === deleteTarget);
        let deleteUrl: string;
        if (item?.type === "resume") {
          deleteUrl = `http://localhost:8001/api/resume/analyses/${deleteTarget}`;
        } else if (item?.type === "live") {
          // PR6: 实时面试用 liveId 删（item.id 是 session_id，可能为空）
          if (!item.liveId) {
            auth.triggerToast("该实时面试缺少 liveId，无法删除");
            setIsDeleting(false);
            setDeleteTarget(null);
            return;
          }
          deleteUrl = `http://localhost:8001/api/live/sessions/${item.liveId}`;
        } else {
          deleteUrl = `http://localhost:8001/api/audio/session/${deleteTarget}`;
        }

        const res = await fetch(deleteUrl, {
          method: "DELETE",
          headers
        });

        if (res.ok) {
            setSelectedIds(prev => prev.filter(x => x !== deleteTarget));
            await fetchSessions();
          } else {
            const errData = await res.json();
            auth.triggerToast(errData.detail || "删除失败");
          }
      }
    } catch (err) {
      console.error("Deletion failed:", err);
      auth.triggerToast("删除请求失败，请稍后重试");
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  // Main list filters
  const filteredHistory = historyItems.filter(
    (item) =>
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const visibleItems = filteredHistory.filter(
    item => activeTimelineFilter === "all" || item.type === activeTimelineFilter
  );

  // 分页：按 TIMELINE_PAGE_SIZE 切片，filter/search 变化时由 setTimelinePage(1) 回到首页
  const timelineTotalPages = Math.max(1, Math.ceil(visibleItems.length / TIMELINE_PAGE_SIZE));
  // 防止当前页超出总页数（如删完最后一条后）
  const safeTimelinePage = Math.min(timelinePage, timelineTotalPages);
  const pageItems = visibleItems.slice(
    (safeTimelinePage - 1) * TIMELINE_PAGE_SIZE,
    safeTimelinePage * TIMELINE_PAGE_SIZE
  );
  const visibleIds = pageItems.map(item => item.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));

  return (
    <main className="pt-20 bg-background text-on-surface select-text min-h-screen flex flex-col justify-between relative overflow-hidden pb-4">
      {/* Absolute Ambient Halo */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[140px] -z-10 pointer-events-none"></div>

      {/* Top Header Navbar */}
      <nav className="fixed top-0 w-full z-40 bg-surface/80 backdrop-blur-xl border-b border-white/10">
        <div className="flex justify-between items-center h-20 px-gutter max-w-container-max mx-auto w-full relative">
          <div
            onClick={() => router.push("/")}
            className="text-2xl font-display-xl font-bold tracking-tight text-on-surface flex items-center gap-2 cursor-pointer"
          >
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L20 7V17L12 22L4 17V7L12 2Z" fill="url(#nav-brand-logo)" />
              <path d="M12 6L16 11H13V18L12 18L11 18V13H8L12 6Z" fill="#0b1326" />
              <defs>
                <linearGradient id="nav-brand-logo" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#c0c1ff" />
                  <stop offset="100%" stopColor="#ffb2b7" />
                </linearGradient>
              </defs>
            </svg>
            面试VAR
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-8">
            <a onClick={() => router.push("/debugger")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              面试调试器
            </a>
            <a onClick={() => handleTabChange("overview")} className="text-primary transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer relative after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
              职业记忆看板
            </a>
            <a onClick={() => router.push("/training")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              面试训练场
            </a>
            <a onClick={() => router.push("/home")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              职业驾驶舱
            </a>
            <a onClick={() => router.push("/feedback")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              体验反馈中心
            </a>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/debugger")}
              className="px-4.5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-bold text-on-surface hover:bg-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">add</span>新建分析
            </button>
            {auth.isLoggedIn ? (
              <UserMenu />
            ) : (
              <>
                <button
                  onClick={() => auth.setShowLogin(true)}
                  className="px-6 py-2 text-on-surface-variant hover:text-on-surface transition-colors font-medium cursor-pointer"
                >
                  登录
                </button>
                <button
                  onClick={() => router.push("/register")}
                  className="px-6 py-2 bg-primary text-on-primary font-bold rounded-full scale-95 hover:scale-100 active:scale-95 transition-all shadow-[0_0_20px_rgba(192,193,255,0.3)] cursor-pointer"
                >
                  免费开始
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Main Workspace Frame */}
      <div className={`flex-1 max-w-container-max mx-auto w-full px-gutter py-8 grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch relative z-10 ${
        activeTab === "advisor" ? "h-[1080px] max-h-[1080px] overflow-hidden" : ""
      }`}>
        
        {/* ========================================================
            LEFT SIDEBAR: 职业记忆库 navigation
           ======================================================== */}
        <div className="col-span-12 md:col-span-3 lg:col-span-2.5 flex flex-col justify-between gap-6 h-full min-h-0">
          <div className="glass-panel p-5 rounded-3xl border-white/10 flex flex-col gap-6 text-left h-full min-h-0 overflow-hidden">
            <div>
              <span className="text-[10px] font-label-mono tracking-widest text-primary font-bold uppercase">
                Career Memory
              </span>
              <h3 className="text-xl font-black text-white mt-1">职业记忆库</h3>
            </div>

            {/* Navigation Tabs Menu */}
            <div className="flex flex-col gap-1.5 w-full">
              {[
                { id: "overview", label: "总览看板", icon: "dashboard" },
                { id: "timeline", label: "分析时间轴", icon: "schedule" },
                { id: "projects", label: "项目记忆库", icon: "folder_shared" },
                { id: "knowledge", label: "知识库", icon: "auto_stories" },
                { id: "weaknesses", label: "弱点分析", icon: "analytics" },
                { id: "growth", label: "成长轨迹", icon: "trending_up" },
                { id: "advisor", label: "AI 职业顾问", icon: "support_agent" }
              ].map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id, tab.id === "advisor")}
                    className={`flex items-center gap-3.5 px-4.5 py-4 rounded-2xl text-base font-black transition-all w-full text-left cursor-pointer group ${
                      isActive
                        ? "bg-primary text-on-primary shadow-lg shadow-primary/20 scale-[1.02]"
                        : "text-on-surface-variant/70 hover:text-white hover:bg-white/5 active:scale-98"
                    }`}
                  >
                    <span className={`material-symbols-outlined text-[20px] transition-transform group-hover:scale-110 ${
                      isActive ? "text-on-primary" : "text-primary"
                    }`}>
                      {tab.icon}
                    </span>
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* One-click start new session */}
            <button
              onClick={() => {
                newCounselorSession();
                handleTabChange("advisor");
              }}
              className="w-full py-2.5 bg-gradient-to-r from-primary/20 to-secondary/20 hover:from-primary/30 hover:to-secondary/30 text-base font-black text-white rounded-xl border border-primary/30 hover:border-primary/50 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-primary/5"
            >
              <span className="material-symbols-outlined text-sm font-bold">add</span>
              新建会话
            </button>

            {/* History Session List */}
            <div className="flex flex-col gap-2.5 flex-1 min-h-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-label-mono tracking-widest text-on-surface-variant/40 font-bold uppercase">
                  历史会话
                </span>
                {counselorSessions.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => loadCounselorSessions(counselorPage)}
                      title="刷新历史会话"
                      className="p-1 rounded-md text-on-surface-variant/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer flex items-center justify-center translate-y-[1px]"
                    >
                      <span className="material-symbols-outlined text-[15px] leading-none">refresh</span>
                    </button>
                    <label className="flex items-center gap-1 cursor-pointer text-sm font-bold text-on-surface-variant/60 hover:text-white transition-all select-none">
                      <input
                        type="checkbox"
                        checked={counselorSessions.length > 0 && counselorSessions.every(s => selectedCounselorIds.includes(s.id))}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedCounselorIds(counselorSessions.map(s => s.id));
                          } else {
                            setSelectedCounselorIds([]);
                          }
                        }}
                        className="w-3 h-3 rounded border-white/10 bg-white/5 text-primary focus:ring-primary focus:ring-offset-0 focus:ring-1 cursor-pointer transition-all accent-primary"
                      />
                      全选
                    </label>
                    {selectedCounselorIds.length > 0 && (
                      <button
                        onClick={handleDeleteCounselorSessionBatch}
                        className="text-[10px] text-red-400 hover:text-red-300 font-bold flex items-center gap-0.5 cursor-pointer transition-colors"
                        title="批量删除"
                      >
                        <span className="material-symbols-outlined text-[12px]">delete_sweep</span>
                        删除({selectedCounselorIds.length})
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="overflow-y-auto max-h-[280px] flex-1 min-h-0 pr-1 flex flex-col gap-1.5">
                {counselorSessions.length === 0 ? (
                  <div className="text-center py-8 text-xs text-on-surface-variant/40">
                    暂无历史会话
                  </div>
                ) : (
                  counselorSessions.map((s) => {
                    const isActive = activeTab === "advisor" && counselorSessionId === s.id;
                    const displaySummary = s.summary || s.title || "新会话";
                    return (
                      <div
                        key={s.id}
                        onClick={() => {
                          loadCounselorSession(s.id);
                          handleTabChange("advisor");
                        }}
                        title={displaySummary}
                        className={`group flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                          isActive
                            ? "bg-primary/10 border-primary/30 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]"
                            : "bg-white/0 border-transparent text-on-surface-variant hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={selectedCounselorIds.includes(s.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedCounselorIds(prev => [...prev, s.id]);
                              } else {
                                setSelectedCounselorIds(prev => prev.filter(id => id !== s.id));
                              }
                            }}
                            className="w-3.5 h-3.5 rounded border-white/10 bg-white/5 text-primary focus:ring-primary focus:ring-offset-0 focus:ring-1 cursor-pointer transition-all accent-primary shrink-0"
                          />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-sm font-bold truncate pr-1">
                              {displaySummary}
                            </span>
                            <span className="text-xs text-on-surface-variant/40 mt-0.5">
                              {formatRelativeTime(s.created_at || "")}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCounselorSession(s.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 text-on-surface-variant/60 hover:text-red-400 rounded-lg transition-all"
                          title="删除会话"
                        >
                          <span className="material-symbols-outlined text-[16px] block">
                            delete
                          </span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pagination Controls — 参考分析时间轴模式：只要有会话就显示分页按钮 */}
              {counselorSessionsTotal > 0 && (() => {
                const totalPages = Math.max(1, Math.ceil(counselorSessionsTotal / COUNSELOR_PAGE_SIZE));
                const pageList = buildPageList(counselorPage, totalPages);
                return (
                  <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between font-label-mono text-xs text-on-surface-variant/50 w-full select-none">
                    <span>共 {counselorSessionsTotal} 条</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCounselorPage(p => Math.max(1, p - 1))}
                        disabled={counselorPage <= 1}
                        className={`px-2.5 py-1 rounded border border-white/5 ${
                          counselorPage <= 1
                            ? "bg-white/5 text-white/30 cursor-not-allowed"
                            : "bg-white/5 hover:bg-white/10 hover:text-white cursor-pointer"
                        }`}
                      >
                        &lt;
                      </button>
                      {pageList.map((p, idx) =>
                        p === "…" ? (
                          <span key={`e-${idx}`} className="px-1.5 py-1 text-on-surface-variant/40">…</span>
                        ) : (
                          <button
                            key={p}
                            onClick={() => setCounselorPage(p)}
                            className={`px-2.5 py-1 rounded cursor-pointer transition-all ${
                              counselorPage === p
                                ? "bg-primary text-on-primary font-bold"
                                : "bg-white/5 hover:bg-white/10 hover:text-white border border-white/5"
                            }`}
                          >
                            {p}
                          </button>
                        )
                      )}
                      <button
                        onClick={() => setCounselorPage(p => Math.min(totalPages, p + 1))}
                        disabled={counselorPage >= totalPages}
                        className={`px-2.5 py-1 rounded border border-white/5 ${
                          counselorPage >= totalPages
                            ? "bg-white/5 text-white/30 cursor-not-allowed"
                            : "bg-white/5 hover:bg-white/10 hover:text-white cursor-pointer"
                        }`}
                      >
                        &gt;
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Footer Retention Note — 放在 history block 内部，让 history 框延伸到面板底部，与右侧卡片对齐 */}
              <div className="mt-auto p-3.5 rounded-xl bg-white/5 border border-white/5 text-left flex items-center gap-2.5">
                <span className="material-symbols-outlined text-xs text-on-surface-variant/60 shrink-0">
                  info
                </span>
                <p className="text-xs text-on-surface-variant/60 leading-normal font-bold">
                  历史会话仅保留30天，系统将自动清理过期记录
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================
            RIGHT CONTAINER: Header + Grid Widgets + Footer
           ======================================================== */}
        <div className={`col-span-12 md:col-span-9 lg:col-span-9.5 flex flex-col gap-6 h-full max-h-full min-h-0 ${activeTab === "advisor" ? "overflow-hidden" : ""}`}>

          {/* ========================================================
              TOP PROFILE SUMMARY BAR
             ======================================================== */}
          {/* ========================================================
              TOP PROFILE SUMMARY BAR
             ======================================================== */}
          <div className="glass-panel p-6 rounded-3xl border-white/10 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 text-left relative overflow-hidden w-full">
            <div className="flex items-center gap-5 flex-wrap w-full xl:w-auto">
              {/* User Avatar */}
              <div className="relative shrink-0 select-none">
                <div className="w-20 h-20 rounded-full border border-primary/30 overflow-hidden bg-slate-900 flex items-center justify-center shadow-2xl relative z-10">
                  {!avatarError ? (
                    <img
                      src={auth.user.avatar}
                      alt={auth.user.name}
                      className="w-full h-full object-cover"
                      onError={() => setAvatarError(true)}
                    />
                  ) : (
                    <span className="material-symbols-outlined text-4xl text-primary opacity-60">person</span>
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 bg-tertiary w-4.5 h-4.5 rounded-full border-2 border-background flex items-center justify-center z-20">
                  <span className="w-1.5 h-1.5 bg-white rounded-full" />
                </div>
              </div>

              {/* Basic Infos */}
              <div className="space-y-2 min-w-0 flex-1 sm:flex-initial">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
                    <h2 className="text-xl font-black text-white whitespace-nowrap">{auth.user.name}</h2>
                  </div>
                  <span className="px-3.5 py-1 rounded-full bg-tertiary/10 text-tertiary text-xs md:text-sm font-black border border-tertiary/20 whitespace-nowrap">
                    {auth.user.status || "在职"}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-on-surface-variant/60 font-semibold font-label-mono">
                  <span className="flex items-center gap-1 whitespace-nowrap"><span className="material-symbols-outlined text-xs text-primary">apartment</span>{auth.user.company || "腾讯科技"}</span>
                  <span className="flex items-center gap-1 whitespace-nowrap"><span className="material-symbols-outlined text-xs text-primary">work</span>{auth.user.role ? auth.user.role.split(" · ")[0] : "后端开发工程师"}</span>
                  <span className="flex items-center gap-1 whitespace-nowrap"><span className="material-symbols-outlined text-xs text-primary">military_tech</span>{auth.user.role ? auth.user.role.split(" · ")[1] || "P6" : "P6"}</span>
                  <span className="flex items-center gap-1 whitespace-nowrap"><span className="material-symbols-outlined text-xs text-primary">pin_drop</span>{auth.user.targetCity || "—"}</span>
                  <span className="flex items-center gap-1 whitespace-nowrap"><span className="material-symbols-outlined text-xs text-primary">schedule</span>{auth.user.years || "6年经验"}</span>
                </div>
              </div>
            </div>

            {/* Targets and AI summary ring */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap xl:flex-nowrap items-stretch sm:items-center gap-6 w-full xl:w-auto border-t xl:border-t-0 pt-4 xl:pt-0 border-white/5 shrink-0">
              
              {/* Target info card */}
              <div className="flex gap-5 px-4.5 py-3.5 rounded-2xl bg-white/[0.02] border border-white/5 shrink-0 justify-between sm:justify-start">
                <div className="text-left whitespace-nowrap min-w-0">
                  <span className="text-[11px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block whitespace-nowrap">目标岗位</span>
                  <span className="text-base font-black text-white block mt-0.5 whitespace-nowrap">{auth.user.targetRole || "—"}</span>
                </div>
                <div className="w-px bg-white/10 self-stretch my-1 shrink-0"></div>
                <div className="text-left whitespace-nowrap min-w-0">
                  <span className="text-[11px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block whitespace-nowrap">目标薪资</span>
                  <span className="text-base font-black text-tertiary block mt-0.5 whitespace-nowrap">{auth.user.targetSalary || "—"}</span>
                </div>
              </div>

              {/* AI Summary progress widget */}
              <div className="flex items-center gap-4.5 p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 flex-1 xl:flex-none">
                <div className="text-left">
                  <span className="text-xs md:text-sm font-label-mono text-primary font-black uppercase tracking-wider block">AI 职业总结</span>
                  <ul className="text-xs text-on-surface-variant/60 space-y-0.5 mt-1 list-disc list-inside font-semibold leading-relaxed">
                    <li>目标岗位：{auth.user.targetRole || "—"}</li>
                    <li>目标公司：{auth.user.targetCompany || "—"}</li>
                    <li>目标职级：{auth.user.targetGrade || "—"}</li>
                    <li>岗位匹配度预计 <span className="text-primary font-extrabold">{auth.user.matchRate ?? 0}%</span></li>
                  </ul>
                </div>

                <div className="relative w-16 h-16 flex items-center justify-center shrink-0">
                  <svg className="w-full h-full -rotate-90">
                    <circle cx="32" cy="32" r="26" fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="4.5" />
                    <circle
                      cx="32"
                      cy="32"
                      r="26"
                      fill="transparent"
                      stroke="url(#summary-circle-gradient)"
                      strokeWidth="4.5"
                      strokeDasharray={2 * Math.PI * 26}
                      strokeDashoffset={2 * Math.PI * 26 * (1 - (auth.user.matchRate ?? 0) / 100)}
                      strokeLinecap="round"
                    />
                    <defs>
                      <linearGradient id="summary-circle-gradient" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#c0c1ff" />
                        <stop offset="100%" stopColor="#ffb2b7" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-sm font-black text-white font-label-mono">{auth.user.matchRate ?? 0}%</span>
                  </div>
                </div>

              </div>

            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className={`w-full flex-1 min-h-0 ${activeTab === "advisor" ? "flex flex-col h-0 overflow-hidden" : ""}`}
            >
              {/* ========================================================
                  TAB PANEL 1: OVERVIEW DASHBOARD (总览看板)
                 ======================================================== */}
              {activeTab === "overview" && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch w-full">
                  
                  {/* CARD 1: 最近活动 */}
                  <div className="col-span-12 md:col-span-4 flex flex-col">
                    <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-5">
                      <div className="space-y-4 flex-1">
                        <div className="flex justify-between items-center pb-1">
                          <h4 className="text-base font-black text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-base text-primary">schedule</span>
                            最近活动
                          </h4>
                          <button
                            onClick={() => handleTabChange("timeline")}
                            className="text-xs text-on-surface-variant/60 hover:text-white flex items-center gap-0.5 cursor-pointer transition-colors font-bold"
                          >
                            查看全部
                            <span className="material-symbols-outlined text-sm leading-none">chevron_right</span>
                          </button>
                        </div>

                        {/* Recent Nodes List */}
                        <div className="relative pl-5.5 space-y-4.5 py-1">
                          <div className="absolute left-1.5 top-2.5 bottom-2.5 w-0.5 bg-white/5"></div>
                          
                          {historyItems.length > 0 ? (() => {
                            const getAnalysisTypeInfo = (type: "audio" | "text" | "resume" | "live") => {
                              switch (type) {
                                case "audio":
                                  return {
                                    label: "录音分析",
                                    dotColor: "bg-primary",
                                    textColor: "text-primary/70",
                                  };
                                case "text":
                                  return {
                                    label: "记录分析",
                                    dotColor: "bg-purple-400",
                                    textColor: "text-purple-400/70",
                                  };
                                case "resume":
                                  return {
                                    label: "简历优化",
                                    dotColor: "bg-secondary",
                                    textColor: "text-secondary/70",
                                  };
                                case "live":
                                  return {
                                    label: "模拟面试",
                                    dotColor: "bg-tertiary",
                                    textColor: "text-tertiary/70",
                                  };
                                default:
                                  return {
                                    label: "录音分析",
                                    dotColor: "bg-primary",
                                    textColor: "text-primary/70",
                                  };
                              }
                            };

                            return historyItems.slice(0, 5).map((item, index) => {
                              const typeInfo = getAnalysisTypeInfo(item.type);
                              const displayTime = formatRelativeTime(item.raw_created_at || item.date);
                              
                              const companyText = item.company || "模拟面试";
                              const roleText = item.role;
                              const bracketText = item.type === "resume" ? item.round : (item.raw_created_at ? item.raw_created_at.split('T')[0] : (item.date.includes(' ') ? item.date.split(' ')[0] : item.date));

                              return (
                                <div key={index} className="relative flex justify-between items-center group py-0.5">
                                  <div className={`absolute -left-[19px] top-1.5 w-2 h-2 rounded-full ring-4 ring-[#11131a] z-10 ${typeInfo.dotColor}`} />
                                  
                                  <div className="space-y-1 text-left">
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant/40">
                                      <span>{displayTime}</span>
                                      <span>|</span>
                                      <span className={typeInfo.textColor}>{typeInfo.label}</span>
                                    </div>
                                    <p className="text-xs md:text-sm text-white/90 font-medium">
                                      {companyText} · {roleText}
                                    </p>
                                  </div>

                                  <div className={`px-2.5 py-1 rounded-full text-xs border font-label-mono shrink-0 ${
                                    item.score > 0 && item.score < 60
                                      ? "bg-[#fb7185]/10 text-[#fb7185] border-[#fb7185]/20 font-bold"
                                      : item.score >= 60
                                        ? "bg-white/5 text-[#94a3b8] border-white/5 font-semibold"
                                        : "bg-white/5 text-on-surface-variant/40 border-white/5"
                                  }`}>
                                    评分 <span className="ml-0.5">{item.score > 0 ? item.score : "待评估"}</span>
                                  </div>
                                </div>
                              );
                            });
                          })() : (
                            <div className="text-xs text-on-surface-variant/50 text-center py-4">
                              {auth.isLoggedIn ? "暂无历史面试记录" : "请先登录查看历史记录"}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CARD 2: 能力成长曲线 (Capability Growth Curve) */}
                  <div className="col-span-12 md:col-span-5 flex flex-col">
                    <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-4">
                      <div className="space-y-4 flex-1">
                        <div>
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="text-base font-black text-white flex items-center gap-2">
                                <span className="material-symbols-outlined text-base text-primary">trending_up</span>
                                能力成长曲线
                              </h4>
                              <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">
                                {growthMode === "recent"
                                  ? `基于最近 ${Math.min(growthTotal, 6)} 次面试分析的能力维度趋势`
                                  : `基于全部 ${growthTotal} 次面试分析的能力维度趋势`}
                              </p>
                            </div>
                            {/* 最近六次 / 全部 切换 */}
                            <div className="flex bg-white/5 rounded-xl border border-white/10 p-0.5 shrink-0">
                              <button
                                onClick={() => setGrowthMode("recent")}
                                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                                  growthMode === "recent"
                                    ? "bg-primary text-on-primary shadow-md shadow-primary/10"
                                    : "text-on-surface-variant/60 hover:text-white"
                                }`}
                              >
                                最近六次
                              </button>
                              <button
                                onClick={() => setGrowthMode("all")}
                                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                                  growthMode === "all"
                                    ? "bg-primary text-on-primary shadow-md shadow-primary/10"
                                    : "text-on-surface-variant/60 hover:text-white"
                                }`}
                              >
                                全部
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Chart Legend indicators — 五个维度 */}
                        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs font-extrabold text-on-surface-variant/60">
                          {[
                            { name: "细节深度", color: "bg-purple-500" },
                            { name: "逻辑自洽", color: "bg-pink-500" },
                            { name: "业务理解", color: "bg-tertiary" },
                            { name: "数据指标", color: "bg-amber-500" },
                            { name: "技术广度", color: "bg-sky-500" },
                          ].map((legend, idx) => (
                            <span key={idx} className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${legend.color}`}></span>
                              {legend.name}
                            </span>
                          ))}
                        </div>

                        {/* 能力成长曲线图 (真实数据) */}
                        <div className="relative w-full h-[250px] mt-2">
                          {isLoadingGrowth ? (
                            <div className="w-full h-full flex items-center justify-center">
                              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                            </div>
                          ) : (
                            <GrowthCurveChart
                              points={growthPoints}
                              axisLabels={growthAxisLabels}
                              compact
                              onPointClick={handleGrowthPointClick}
                              mode={growthMode}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CARD 3: 长期弱点分析 (Long-term Weakness Analysis) */}
                  <div className="col-span-12 md:col-span-3 flex flex-col">
                    <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-4">
                      <div className="space-y-4 flex-1">
                        <div>
                          <h4 className="text-base font-black text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-base text-secondary">trending_down</span>
                            长期弱点分析
                          </h4>
                          <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">基于最近 30 次分析统计频次</p>
                        </div>

                        {/* Weakness Bars */}
                        <div className="space-y-3">
                          {[
                            { name: "系统设计表达", count: 17, max: 20, color: "bg-primary" },
                            { name: "Trade-off 分析", count: 14, max: 20, color: "bg-secondary" },
                            { name: "项目量化指标", count: 12, max: 20, color: "bg-amber-500" },
                            { name: "架构选型理由", count: 10, max: 20, color: "bg-tertiary" },
                            { name: "领导力案例", count: 8, max: 20, color: "bg-indigo-500" }
                          ].map((item, idx) => (
                            <div key={idx} className="space-y-1">
                              <div className="flex justify-between text-xs font-bold text-on-surface-variant/80">
                                <span>{item.name}</span>
                                <span>{item.count} 次</span>
                              </div>
                              <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${item.color}`}
                                  style={{ width: `${(item.count / item.max) * 100}%` }}
                                ></div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* AI Insight Box */}
                        <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/5 space-y-1.5 mt-2">
                          <div className="flex items-center gap-1.5 text-[14.5px] font-black text-primary">
                            <span className="material-symbols-outlined text-[17px] animate-pulse">
                              psychology
                            </span>
                            AI 洞察
                          </div>
                          <p className="text-xs text-on-surface-variant/80 leading-relaxed font-bold">
                            你的核心问题在于"架构对比和方案折中分析能力"不足，而非单纯技术深度不够。
                          </p>
                          <a
                            onClick={() => handleTabChange("weaknesses")}
                            className="text-sm font-black text-primary hover:text-white transition-colors flex items-center gap-1 cursor-pointer pt-0.5"
                          >
                            查看优化建议 <span className="material-symbols-outlined text-xs">keyboard_arrow_right</span>
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CARD 4: 项目记忆库 (Project Memory Bank) */}
                  <div className="col-span-12 md:col-span-4 flex flex-col">
                    <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-5">
                      <div className="space-y-4 flex-1">
                        <div>
                          <h4 className="text-base font-black text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-base text-primary">folder_shared</span>
                            项目记忆库
                          </h4>
                          <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">AI 自动提取并结构化的项目信息</p>
                        </div>

                        {/* Project list widgets */}
                        <div className="space-y-3">
                          {isLoadingProjects ? (
                            Array.from({ length: 3 }).map((_, idx) => (
                              <div key={idx} className="p-3.5 rounded-2xl bg-white/[0.01] border border-white/5 flex items-center gap-3 animate-pulse">
                                <div className="w-8 h-8 rounded-xl bg-white/5" />
                                <div className="space-y-1.5 flex-1">
                                  <div className="h-3.5 bg-white/5 rounded w-24" />
                                  <div className="h-2.5 bg-white/5 rounded w-32" />
                                </div>
                              </div>
                            ))
                          ) : projects.length === 0 ? (
                            <div className="py-6 text-center">
                              <span className="material-symbols-outlined text-3xl text-on-surface-variant/30 mb-1 block">folder_off</span>
                              <p className="text-xs text-on-surface-variant/40 font-semibold">暂无项目记忆</p>
                            </div>
                          ) : (
                            projects.slice(0, 3).map((proj) => {
                              const colorMap: Record<string, string> = {
                                "AI工程": "text-secondary bg-secondary/10 border-secondary/20",
                                "交易骨干": "text-tertiary bg-tertiary/10 border-tertiary/20",
                                "数据工程": "text-primary bg-primary/10 border-primary/20",
                              };
                              const colorClass = colorMap[proj.category] || "text-primary bg-primary/10 border-primary/20";
                              const initial = (proj.project_name || "?")[0].toUpperCase();
                              return (
                                <div
                                  key={proj.id}
                                  onClick={() => setSelectedProject(proj)}
                                  className="p-3.5 rounded-2xl bg-white/[0.01] hover:bg-white/[0.03] active:scale-[0.985] border border-white/5 flex items-center justify-between gap-3 group transition-all cursor-pointer"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${colorClass}`}>
                                      {initial}
                                    </div>
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <h5 className="text-sm font-black text-white group-hover:text-primary transition-colors">{proj.project_name}</h5>
                                        {(proj.tech_stack || []).slice(0, 2).map((t, i) => (
                                          <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-black border bg-white/5 text-on-surface-variant/50 border-white/5">
                                            {t}
                                          </span>
                                        ))}
                                      </div>
                                      <p className="text-xs text-on-surface-variant/40 font-semibold">
                                        面试提及: <span className="text-primary font-black font-label-mono">{proj.mention_count || 0}</span> 次
                                      </p>
                                    </div>
                                  </div>
                                  <span className="material-symbols-outlined text-sm text-on-surface-variant/30 group-hover:text-white transition-all group-hover:translate-x-0.5">
                                    arrow_forward
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleTabChange("projects")}
                        className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-xs font-black text-white rounded-xl border border-white/10 transition-all text-center cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        查看全部项目 ({projectTotal}) <span className="material-symbols-outlined text-xs">keyboard_arrow_right</span>
                      </button>
                    </div>
                  </div>

                  {/* CARD 5: 知识库 (Knowledge Base) */}
                  <div className="col-span-12 md:col-span-4 flex flex-col">
                    <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-5">
                      <div className="space-y-4 flex-1">
                        <div>
                          <h4 className="text-base font-black text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-base text-primary">auto_stories</span>
                            知识库 <span className="text-xs text-on-surface-variant/40 font-semibold font-label-mono">(面试题库)</span>
                          </h4>
                          <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">你专属的面试知识图谱</p>
                        </div>

                        {/* Concept indicators list — dynamic from knowledge API */}
                        <div className="space-y-3.5">
                          {(() => {
                            const topSubs = knowledgeAbilities
                              .flatMap((ca) =>
                                ca.sub_abilities.map((sa) => ({
                                  name: sa.name,
                                  count: sa.question_count,
                                  core: ca.name,
                                }))
                              )
                              .sort((a, b) => b.count - a.count)
                              .slice(0, 3);
                            if (topSubs.length === 0) {
                              return (
                                <p className="text-xs text-on-surface-variant/40 text-center py-4">
                                  暂无知识库数据
                                </p>
                              );
                            }
                            const colors = [
                              "from-tertiary/20 to-tertiary/5 border-tertiary/30 text-tertiary",
                              "from-primary/20 to-primary/5 border-primary/30 text-primary",
                              "from-secondary/20 to-secondary/5 border-secondary/30 text-secondary",
                            ];
                            return topSubs.map((item, idx) => (
                              <div key={idx} className="p-3 rounded-2xl bg-gradient-to-r from-white/[0.01] to-transparent border border-white/5 space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="flex items-center gap-2 font-black text-sm text-white">
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                                    {item.name}
                                  </span>
                                  <div className="flex items-center gap-2 text-xs font-bold text-on-surface-variant/50">
                                    <span>被问 {item.count} 次</span>
                                  </div>
                                </div>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>

                      <button
                        onClick={() => handleTabChange("knowledge")}
                        className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-xs font-black text-white rounded-xl border border-white/10 transition-all text-center cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        查看全部知识点 (36) <span className="material-symbols-outlined text-xs">keyboard_arrow_right</span>
                      </button>
                    </div>
                  </div>

                  {/* CARD 6: Offer 概率预测 (Offer Probability Prediction) */}
                  <div className="col-span-12 md:col-span-4 flex flex-col">
                    <div className="glass-panel p-5.5 rounded-3xl border-white/10 text-left h-full flex flex-col justify-between gap-5">
                      <div className="space-y-4 flex-1">
                        <div>
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="text-base font-black text-white flex items-center gap-2">
                                <span className="material-symbols-outlined text-base text-primary">online_prediction</span>
                                Offer 概率预测
                              </h4>
                              <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">
                                {offerMode === "recent"
                                  ? `基于最近 ${Math.min(offerTotalSessions, 6)} 次模拟面试的概率演进`
                                  : `基于全部 ${offerTotalSessions} 次模拟面试的概率演进`}
                              </p>
                            </div>
                            {/* 最近六次 / 全部 切换 */}
                            <div className="flex bg-white/5 rounded-xl border border-white/10 p-0.5 shrink-0">
                              <button
                                onClick={() => setOfferMode("recent")}
                                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                                  offerMode === "recent"
                                    ? "bg-primary text-on-primary shadow-md shadow-primary/10"
                                    : "text-on-surface-variant/60 hover:text-white"
                                }`}
                              >
                                最近六次
                              </button>
                              <button
                                onClick={() => setOfferMode("all")}
                                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                                  offerMode === "all"
                                    ? "bg-primary text-on-primary shadow-md shadow-primary/10"
                                    : "text-on-surface-variant/60 hover:text-white"
                                }`}
                              >
                                全部
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Current offer metric */}
                        <div className="flex justify-between items-center p-3.5 rounded-2xl bg-white/[0.01] border border-white/5">
                          <div>
                            <span className="text-xs text-on-surface-variant/40 font-extrabold uppercase">当前 Offer 概率</span>
                            <h3 className="text-4xl font-black text-white mt-1 font-label-mono">
                              {isLoadingOfferTrend ? (
                                <span className="text-on-surface-variant/30">—</span>
                              ) : offerCurrentProb !== null ? (
                                <>{offerCurrentProb}<span className="text-lg text-on-surface-variant/50 font-normal">%</span></>
                              ) : (
                                <span className="text-on-surface-variant/30">—</span>
                              )}
                            </h3>
                          </div>

                          {/* Pulsing indicator core */}
                          <div className="relative w-12 h-12 flex items-center justify-center bg-primary/10 rounded-full border border-primary/20">
                            <span className="material-symbols-outlined text-xl text-primary animate-pulse">verified_user</span>
                          </div>
                        </div>

                        {/* Interactive Prediction SVG Graph */}
                        <div className="relative w-full h-[95px] select-none group/offer">
                          {isLoadingOfferTrend ? (
                            <div className="w-full h-full flex items-center justify-center">
                              <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                            </div>
                          ) : offerTrendPoints.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-[11px] text-on-surface-variant/40 font-semibold">
                              暂无实时模拟面试数据
                            </div>
                          ) : (
                            <>
                              <svg className="w-full h-full" viewBox="0 0 100 50" preserveAspectRatio="none">
                                {/* SVG Gradients definitions */}
                                <defs>
                                  <linearGradient id="offer-area-gradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
                                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                                  </linearGradient>
                                  <linearGradient id="offer-line-gradient" x1="0" y1="0" x2="1" y2="0">
                                    <stop offset="0%" stopColor="#3b82f6" />
                                    <stop offset="50%" stopColor="#10b981" />
                                    <stop offset="100%" stopColor="#22d3ee" />
                                  </linearGradient>
                                </defs>

                                {(() => {
                                  const pts = displayOfferData.points;
                                  const xMax = displayOfferData.xMax;
                                  const padL = 5;
                                  const padR = 5;
                                  const viewW = 100;
                                  const viewH = 50;
                                  const padT = 5;
                                  const padB = 5;
                                  const chartW = viewW - padL - padR;
                                  const chartH = viewH - padT - padB;

                                  const idxToX = (pos: number) => {
                                    if (xMax <= 1) return padL + chartW / 2;
                                    return padL + ((pos - 1) / (xMax - 1)) * chartW;
                                  };
                                  const probToY = (p: number) => {
                                    return padT + chartH * (1 - Math.max(0, Math.min(100, p)) / 100);
                                  };

                                  const lineCoords: { x: number; y: number }[] = pts.map((pt: any, i: number) => ({
                                    x: idxToX(i + 1),
                                    y: probToY(pt.offer_probability ?? 0),
                                  }));

                                  // Area path
                                  const areaD = lineCoords.length > 0
                                    ? lineCoords.map((c: { x: number; y: number }, i: number) => `${i === 0 ? "M" : "L"} ${c.x},${c.y}`).join(" ")
                                      + ` L ${lineCoords[lineCoords.length - 1].x},${padT + chartH}`
                                      + ` L ${lineCoords[0].x},${padT + chartH} Z`
                                    : "";
                                  // Line path
                                  const lineD = lineCoords.map((c: { x: number; y: number }, i: number) => `${i === 0 ? "M" : "L"} ${c.x},${c.y}`).join(" ");

                                  return (
                                    <>
                                      {/* Filled Area below path */}
                                      {lineCoords.length > 0 && (
                                        <path d={areaD} fill="url(#offer-area-gradient)" />
                                      )}
                                      {/* Sparkline Path */}
                                      {lineCoords.length > 0 && (
                                        <path d={lineD} fill="none" stroke="url(#offer-line-gradient)" strokeWidth="1.2" strokeLinecap="round" />
                                      )}

                                      {/* Data point dots + hover targets */}
                                      {lineCoords.map((c: { x: number; y: number }, i: number) => (
                                        <g key={i}>
                                          {/* Invisible larger hit area for precise hover */}
                                          <circle
                                            cx={c.x}
                                            cy={c.y}
                                            r="4"
                                            fill="transparent"
                                            className="cursor-pointer"
                                            onMouseEnter={() => setActiveOfferIdx(i)}
                                            onMouseLeave={() => setActiveOfferIdx(null)}
                                          />
                                          {/* Visible dot */}
                                          <circle
                                            cx={c.x}
                                            cy={c.y}
                                            r="1.5"
                                            fill="#10b981"
                                            stroke="rgba(255,255,255,0.3)"
                                            strokeWidth="0.5"
                                            className="pointer-events-none"
                                          />
                                        </g>
                                      ))}
                                    </>
                                  );
                                })()}
                              </svg>

                              {/* X-axis labels — SVG 坐标系绝对定位，与圆点精确对齐 */}
                              {displayOfferData.displayCount > 0 && (
                                <div className="relative w-full h-[18px] mt-0.5">
                                  {displayOfferData.labelIndices.map((labelIdx: number) => {
                                    // 使用与 idxToX 相同的公式：padL + ratio * chartW，转换为百分比
                                    const xMax = displayOfferData.xMax;
                                    const ratio = xMax <= 1 ? 0.5 : (labelIdx - 1) / (xMax - 1);
                                    const svgX = 5 + ratio * 90; // padL=5, chartW=90
                                    const pct = (svgX / 100) * 100; // viewW=100
                                    const pt = displayOfferData.points[labelIdx - 1];
                                    return (
                                      <span
                                        key={labelIdx}
                                        className="absolute text-[10px] font-label-mono text-on-surface-variant/40 font-bold whitespace-nowrap"
                                        style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
                                      >
                                        第{labelIdx}次
                                      </span>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Tooltip Popup */}
                              {activeOfferIdx !== null && displayOfferData.points[activeOfferIdx] && (
                                <div
                                  className="absolute bg-surface-container-high border border-white/10 rounded-lg p-2 text-[9px] text-white font-label-mono shadow-xl pointer-events-none z-30"
                                  style={{
                                    left: `${5 + (activeOfferIdx / Math.max(1, displayOfferData.xMax - 1)) * 90}%`,
                                    top: "5%"
                                  }}
                                >
                                  <span className="font-extrabold text-primary block">
                                    第{activeOfferIdx + 1}次预测概率
                                  </span>
                                  <span className="text-tertiary font-black font-label-mono mt-0.5 block">
                                    {displayOfferData.points[activeOfferIdx].offer_probability}% Offer 概率
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                        </div>

                        {/* Recommendations summary */}
                        <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 space-y-1 mt-2">
                          <span className="text-xs text-on-surface-variant/40 font-extrabold block">提升建议</span>
                          <p className="text-xs text-on-surface-variant/70 leading-relaxed font-semibold">
                            {offerSuggestion ? (
                              <>
                                如果重点提升"{offerSuggestion.focus_areas.join("和")}"，预计整体概率可跃升至 <span className="text-tertiary font-black">{offerSuggestion.potential_probability}%</span>。
                              </>
                            ) : (
                              <>
                                完成首次实时模拟面试后，AI 将基于面试表现给出针对性提升建议。
                              </>
                            )}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleTabChange("growth")}
                        className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-xs font-black text-white rounded-xl border border-white/10 transition-all text-center cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        查看提升路径 <span className="material-symbols-outlined text-xs">trending_up</span>
                      </button>
                    </div>
                  </div>

                </div>
              )}

              {/* ========================================================
                  TAB PANEL 2: TIMELINE / HISTORICAL ARCHIVES (面试时间轴)
                 ======================================================== */}
              {activeTab === "timeline" && (
                <div className="col-span-12">
                  <div className="glass-panel p-8 rounded-3xl border-white/10 h-full flex flex-col justify-between text-left relative overflow-hidden w-full">
                    
                    <div className="space-y-6 w-full">
                      {/* Header title */}
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-white/5 w-full">
                        <div>
                          <span className="text-[10px] font-label-mono tracking-widest text-primary font-bold uppercase">
                            Comprehensive Timeline
                          </span>
                          <h2 className="text-2xl font-black text-white mt-1">历史分析记录档案</h2>
                        </div>

                        {/* Search and Filters */}
                        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                          <div className="flex bg-white/5 rounded-2xl border border-white/10 p-1">
                            {[
                              { id: "all", label: "全部" },
                              { id: "audio", label: "录音" },
                              { id: "text", label: "文字" },
                              { id: "live", label: "实时" },
                              { id: "resume", label: "简历" }
                            ].map((btn) => (
                              <button
                                key={btn.id}
                                onClick={() => {
                                  setActiveTimelineFilter(btn.id);
                                  setTimelinePage(1);
                                }}
                                className={`px-5 py-2 rounded-xl text-xs md:text-sm font-black transition-all cursor-pointer ${
                                  activeTimelineFilter === btn.id
                                    ? "bg-primary text-on-primary shadow-md shadow-primary/10"
                                    : "text-on-surface-variant/60 hover:text-white"
                                }`}
                              >
                                {btn.label}
                              </button>
                            ))}
                          </div>

                          <div className="relative flex-1 md:flex-none">
                            <span className="material-symbols-outlined text-xs absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40">
                              search
                            </span>
                            <input
                              type="text"
                              placeholder="搜索面试标题、公司或岗位"
                              value={searchQuery}
                              onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setTimelinePage(1);
                              }}
                              className="pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-on-surface-variant/30 focus:outline-none focus:border-primary/40 h-10 w-full md:w-64"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Batch Action Management Bar */}
                      {visibleItems.length > 0 && (
                        <div className="flex justify-between items-center bg-white/[0.02] border border-white/5 p-4.5 rounded-2xl w-full">
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2.5 cursor-pointer text-xs md:text-sm font-bold text-on-surface-variant/80 hover:text-white transition-all select-none">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={handleToggleSelectAll}
                                className="w-4 h-4 rounded border-white/10 bg-white/5 text-primary focus:ring-primary focus:ring-offset-0 focus:ring-1 cursor-pointer transition-all accent-primary"
                              />
                              全选
                            </label>
                            {selectedIds.length > 0 && (
                              <span className="text-xs text-primary font-bold font-label-mono bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full">
                                已选择 {selectedIds.length} 项
                              </span>
                            )}
                          </div>

                          {selectedIds.length > 0 && (
                            <button
                              onClick={() => handleDeleteClick("batch")}
                              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-black rounded-lg transition-all cursor-pointer flex items-center gap-1.5 shadow-lg shadow-red-500/10"
                            >
                              <span className="material-symbols-outlined text-sm">delete_sweep</span>
                              批量删除
                            </button>
                          )}
                        </div>
                      )}

                      {/* Vertical Timeline Nodes */}
                      <div className="relative pl-6 space-y-8 py-4 w-full">
                        {/* Vertical Connecting Line */}
                        <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-white/5"></div>

                        {pageItems.length > 0 ? (
                          pageItems.map((item, index) => {
                            return (
                              <div
                                key={index}
                                className="relative flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-white/[0.01] hover:bg-white/[0.03] border border-white/5 transition-all group"
                              >
                                {/* Left timeline dot */}
                                <div
                                  className={`absolute -left-6 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-background z-10 ${
                                    item.type === "resume"
                                      ? "bg-tertiary"
                                      : item.type === "live"
                                      ? "bg-amber-400"
                                      : item.type === "audio"
                                      ? "bg-primary"
                                      : "bg-secondary"
                                  }`}
                                />

                                <div className="flex items-start gap-4 flex-1">
                                  {/* Selection Checkbox */}
                                  <div className="flex items-center justify-center self-center shrink-0">
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.includes(item.id)}
                                      onChange={() => handleToggleSelect(item.id)}
                                      className="w-4 h-4 rounded border-white/10 bg-white/5 text-primary focus:ring-primary focus:ring-offset-0 focus:ring-1 cursor-pointer transition-all accent-primary"
                                    />
                                  </div>

                                  <div
                                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                      item.type === "resume"
                                        ? "bg-tertiary/10 text-tertiary"
                                        : item.type === "live"
                                        ? "bg-amber-400/10 text-amber-400"
                                        : item.type === "audio"
                                        ? "bg-primary/10 text-primary"
                                        : "bg-secondary/10 text-secondary"
                                    }`}
                                  >
                                    <span className="material-symbols-outlined text-lg">
                                      {item.type === "resume"
                                        ? "description"
                                        : item.type === "live"
                                        ? "graphic_eq"
                                        : item.type === "audio"
                                        ? "graphic_eq"
                                        : "edit_document"}
                                    </span>
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h4 className="font-extrabold text-sm text-white truncate max-w-sm">{item.title}</h4>
                                      <span className="text-[10px] font-label-mono text-on-surface-variant/40 shrink-0">
                                        {item.date}
                                      </span>
                                    </div>
                                    <p className="text-xs text-on-surface-variant/60 mt-1 leading-relaxed max-w-xl font-medium line-clamp-2">
                                      {item.details}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-3.5 self-end md:self-auto shrink-0">
                                  <div className="text-right">
                                    <span className="text-[9px] text-on-surface-variant/40 font-label-mono uppercase tracking-widest font-extrabold block">
                                      {item.type === "live" ? "状态" : "综合得分"}
                                    </span>
                                    <span
                                      className={`text-sm font-black font-label-mono ${
                                        item.type === "live"
                                          ? "text-amber-400"
                                          : item.score >= 80
                                          ? "text-tertiary"
                                          : "text-primary"
                                      }`}
                                    >
                                      {item.type === "live"
                                        ? item.grade
                                        : `${item.score}分 (${item.grade})`}
                                    </span>
                                  </div>

                                  <button
                                    onClick={() => handleViewDetails(item)}
                                    className="px-4 py-2 bg-white/5 border border-white/10 group-hover:bg-primary group-hover:border-primary group-hover:text-on-primary text-white text-xs font-bold rounded-lg transition-all cursor-pointer"
                                  >
                                    查看详情
                                  </button>

                                  <button
                                    onClick={() => handleDeleteClick(item.id)}
                                    className="p-2 bg-white/5 border border-white/10 hover:bg-red-500/20 hover:border-red-500/30 hover:text-red-400 text-on-surface-variant/60 rounded-lg transition-all cursor-pointer flex items-center justify-center"
                                    title="删除记录"
                                  >
                                    <span className="material-symbols-outlined text-base">delete</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="py-12 text-center w-full">
                            <span className="material-symbols-outlined text-4xl text-on-surface-variant/35 mb-2 block">
                              folder_open
                            </span>
                            <p className="text-base text-on-surface-variant/50">未找到符合搜索条件的面试分析历史记录。</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Pagination — 每页 TIMELINE_PAGE_SIZE 条；filter/search 变化会回到第 1 页 */}
                    {visibleItems.length > 0 && (() => {
                      const pageList = buildPageList(safeTimelinePage, timelineTotalPages);
                      return (
                        <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between font-label-mono text-xs text-on-surface-variant/50 w-full select-none">
                          <span>共 {visibleItems.length} 条记录</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setTimelinePage(p => Math.max(1, p - 1))}
                              disabled={safeTimelinePage <= 1}
                              className={`px-2.5 py-1 rounded border border-white/5 ${
                                safeTimelinePage <= 1
                                  ? "bg-white/5 text-white/50 hover:bg-white/10 cursor-not-allowed"
                                  : "bg-white/5 hover:bg-white/10 cursor-pointer"
                              }`}
                            >
                              &lt;
                            </button>
                            {pageList.map((p, idx) =>
                              p === "…" ? (
                                <span key={`e-${idx}`} className="px-2.5 py-1 text-on-surface-variant/40">…</span>
                              ) : (
                                <button
                                  key={p}
                                  onClick={() => setTimelinePage(p)}
                                  className={`px-2.5 py-1 rounded cursor-pointer ${
                                    safeTimelinePage === p
                                      ? "bg-primary text-on-primary font-bold"
                                      : "bg-white/5 hover:bg-white/10 border border-white/5"
                                  }`}
                                >
                                  {p}
                                </button>
                              )
                            )}
                            <button
                              onClick={() => setTimelinePage(p => Math.min(timelineTotalPages, p + 1))}
                              disabled={safeTimelinePage >= timelineTotalPages}
                              className={`px-2.5 py-1 rounded border border-white/5 ${
                                safeTimelinePage >= timelineTotalPages
                                  ? "bg-white/5 text-white/50 hover:bg-white/10 cursor-not-allowed"
                                  : "bg-white/5 hover:bg-white/10 cursor-pointer"
                              }`}
                            >
                              &gt;
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                  </div>
                </div>
              )}

              {/* ========================================================
                  TAB PANEL 3: PROJECTS MEMORY BANK (项目记忆库详情)
                 ======================================================== */}
              {activeTab === "projects" && (
                <>
                  {isLoadingProjects ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full text-left">
                      {Array.from({ length: 6 }).map((_, idx) => (
                        <div key={idx} className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col justify-between gap-5 animate-pulse">
                          <div className="space-y-3.5">
                            <div className="flex justify-between items-start">
                              <div className="h-5 bg-white/5 rounded w-32" />
                              <div className="h-5 bg-white/5 rounded w-16" />
                            </div>
                            <div className="space-y-2">
                              <div className="h-3 bg-white/5 rounded w-full" />
                              <div className="h-3 bg-white/5 rounded w-3/4" />
                            </div>
                          </div>
                          <div className="space-y-2.5 border-t border-white/5 pt-3.5">
                            <div className="flex justify-between">
                              <div className="h-3 bg-white/5 rounded w-20" />
                              <div className="h-3 bg-white/5 rounded w-16" />
                            </div>
                            <div className="w-full h-1.5 bg-white/5 rounded-full" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : projects.length === 0 ? (
                    <div className="py-16 text-center w-full">
                      <span className="material-symbols-outlined text-5xl text-on-surface-variant/25 mb-3 block">folder_off</span>
                      <p className="text-lg font-black text-on-surface-variant/40">暂无项目记忆</p>
                      <p className="text-sm text-on-surface-variant/30 font-semibold mt-1">上传简历进行分析后，AI 将自动提取项目经历</p>
                      <button
                        onClick={() => router.push("/debugger?mode=resume")}
                        className="mt-4 px-5 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary text-sm font-black rounded-xl border border-primary/20 transition-all cursor-pointer inline-flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-base">add</span>新建分析
                      </button>
                    </div>
                  ) : (
                    <div className="glass-panel p-6 rounded-3xl border-white/10 flex flex-col gap-5 w-full text-left">
                      {/* Header of the large card wrapper */}
                      <div className="flex justify-between items-center border-b border-white/5 pb-4">
                        <div>
                          <h4 className="text-lg font-black text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-primary text-[22px]">folder_shared</span>
                            项目记忆库列表
                          </h4>
                          <p className="text-xs text-on-surface-variant/60 font-semibold mt-1">记录并管理您在面试中提及过的核心项目及掌握程度</p>
                        </div>
                        <span className="text-xs font-mono text-on-surface-variant/50">共 {projects.length} 个项目</span>
                      </div>

                      {/* Scrollable grid container */}
                      <div className="max-h-[520px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-1">
                          {projects.map((proj) => (
                            <div 
                              key={proj.id} 
                              onClick={() => setSelectedProject(proj)}
                              className="glass-panel p-5.5 rounded-3xl border-white/10 flex flex-col justify-between gap-5 hover:border-primary/20 hover:scale-[1.01] transition-all group relative cursor-pointer"
                            >
                              {/* Close button with circular background */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation(); // Prevent opening the detail modal!
                                  handleDeleteProject(proj.id);
                                }}
                                className="absolute top-3.5 right-3.5 w-6 h-6 rounded-full bg-red-500 text-white hover:bg-red-600 flex items-center justify-center transition-all cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100 z-10 shadow-lg"
                                title="删除项目"
                              >
                                <span className="material-symbols-outlined text-[13px] font-black">close</span>
                              </button>

                              <div className="space-y-3.5">
                                <div className="flex justify-between items-start pr-6">
                                  <h4 className="text-base font-black text-white group-hover:text-primary transition-colors pr-2 truncate">{proj.project_name}</h4>
                                  <span className="px-2.5 py-1 rounded bg-primary/10 text-primary text-[11px] font-black border border-primary/20 shrink-0">{proj.category}</span>
                                </div>
                                <p className="text-xs md:text-[13px] text-on-surface-variant/75 leading-relaxed font-semibold line-clamp-3">{proj.summary}</p>
                              </div>

                              <div className="space-y-2 border-t border-white/5 pt-3.5">
                                <div className="flex items-center gap-1.5 text-xs text-on-surface-variant/60 font-extrabold">
                                  <span className="material-symbols-outlined text-[13px] text-primary/70">forum</span>
                                  <span>面试提及: <span className="text-primary font-black font-label-mono">{proj.mention_count}</span> 次</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/50 font-semibold">
                                  <span className="material-symbols-outlined text-[12px] text-primary/50 shrink-0">schedule</span>
                                  <span className="truncate">
                                    {proj.last_mentioned_summary
                                      ? `最近提及: ${proj.last_mentioned_summary}`
                                      : "尚未在面试中被提及"}
                                  </span>
                                </div>
                              </div>

                              {proj.tech_stack && proj.tech_stack.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 border-t border-white/5 pt-3">
                                  {proj.tech_stack.slice(0, 4).map((tech, i) => (
                                    <span key={i} className="px-2 py-0.5 rounded bg-white/5 text-on-surface-variant/60 text-[10px] font-bold border border-white/5">
                                      {tech}
                                    </span>
                                  ))}
                                  {proj.tech_stack.length > 4 && (
                                    <span className="px-2 py-0.5 rounded bg-white/5 text-on-surface-variant/40 text-[10px] font-bold">
                                      +{proj.tech_stack.length - 4}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ========================================================
                  TAB PANEL 4: KNOWLEDGE BASE (知识库题谱详情)
                 ======================================================== */}
              {activeTab === "knowledge" && (
                <div className="glass-panel p-6 sm:p-8 rounded-3xl border-white/10 w-full flex flex-col gap-6 text-left">
                  <div className="pb-3 border-b border-white/5 shrink-0 flex items-center justify-between">
                    <h3 className="text-base font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base text-primary">menu_book</span>
                      职业知识库及专业题谱
                    </h3>
                    <span className="text-xs text-on-surface-variant/40 font-mono font-bold">
                      {knowledgeAbilities.length > 0 ? `${knowledgeAbilities.length} 个核心板块` : ""}
                    </span>
                  </div>

                  {isLoadingAbilities ? (
                    <div className="flex items-center justify-center py-20">
                      <img src="/loading.gif" alt="loading" className="w-8 h-8" />
                    </div>
                  ) : knowledgeAbilities.length === 0 ? (
                    <div className="text-center py-16 space-y-3">
                      <span className="material-symbols-outlined text-4xl text-on-surface-variant/30">auto_stories</span>
                      <p className="text-on-surface-variant/50 font-semibold">
                        {auth.user?.targetRole
                          ? "知识库生成中，请稍后刷新..."
                          : "请先在职业驾驶舱完善目标岗位信息，以生成专属知识库"}
                      </p>
                      {!auth.user?.targetRole && (
                        <button
                          onClick={() => router.push("/home")}
                          className="px-5 py-2 bg-primary/20 text-primary text-sm font-bold rounded-xl cursor-pointer hover:bg-primary/30 transition-colors"
                        >
                          前往完善
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="max-h-[580px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
                        {knowledgeAbilities.map((core) => (
                          <div key={core.id} className="bg-white/[0.02] border border-white/5 p-5 rounded-2xl space-y-4 text-left">
                            <span className="text-xs md:text-[13px] font-label-mono text-primary font-bold uppercase tracking-wider block">
                              {core.name}
                            </span>
                            <div className="space-y-3.5">
                              {core.sub_abilities.map((sub) => (
                                <div
                                  key={sub.id}
                                  onClick={() => openKnowledgeModal(core.name, sub.name, sub.question_count, 0)}
                                  className="p-3.5 rounded-2xl bg-white/[0.01] border border-white/5 hover:border-primary/30 hover:bg-white/[0.03] active:scale-[0.985] transition-all duration-200 space-y-2.5 cursor-pointer group"
                                >
                                  <div className="flex justify-between items-start gap-3">
                                    <h5 className="text-xs md:text-sm font-black text-white group-hover:text-primary transition-colors leading-relaxed">{sub.name}</h5>
                                    <span className="text-[11px] font-semibold font-label-mono text-on-surface-variant/50 shrink-0">问 {sub.question_count}次</span>
                                  </div>
                                  <div className="flex items-center justify-between text-[11px] font-semibold text-on-surface-variant/70">
                                    <span>相关问题</span>
                                    <span className="font-black text-white font-label-mono">{sub.question_count} 次</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ========================================================
                  TAB PANEL 5: WEAKNESS ANALYSIS (长期弱点突破)
                 ======================================================== */}
              {activeTab === "weaknesses" && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 w-full text-left">
                  {/* Left Column: Weakness Details List */}
                  <div className="col-span-12 md:col-span-8 flex flex-col gap-6">
                    {[
                      {
                        title: "系统设计表达",
                        freq: "高频雷区 (出现17次)",
                        metric: "架构阐述偏向代码堆砌，缺少链路层宏观抽象。",
                        solution: "梳理完整的技术自述模板，遵循“背景-核心痛点-技术选型-最终表现”四步陈述框架，多画网络拓扑示意图。",
                        color: "border-primary/30"
                      },
                      {
                        title: "Trade-off 深度折中能力",
                        freq: "严重警告 (出现14次)",
                        metric: "被深挖底层逻辑时直接给结论，缺乏对非最优解的优劣比对陈述。",
                        solution: "在描述系统方案前先给出至少两种分支，例如：‘引入Redis虽然提升吞吐，但在极端情况下会面临双写一致性漂移，需要Saga补偿...’",
                        color: "border-secondary/30"
                      },
                      {
                        title: "项目数据量化指标",
                        freq: "核心短板 (出现12次)",
                        metric: "表达仅停留于“性能大幅提高”，未给出具体的QPS或毫秒响应数据差值。",
                        solution: "牢记核心性能指标：重构前吞吐QPS为1200，延迟450ms；重构后QPS攀升至4500，99线延迟控制在50ms以内。",
                        color: "border-amber-500/30"
                      }
                    ].map((item, idx) => (
                      <div key={idx} className={`glass-panel p-6 rounded-3xl border ${item.color} space-y-4`}>
                        <div className="flex justify-between items-center gap-4">
                          <h4 className="text-[17px] font-black text-white">{item.title}</h4>
                          <span className="px-3 py-1.5 rounded-lg bg-white/5 text-[11px] font-black text-on-surface-variant/80 border border-white/10 whitespace-nowrap shrink-0">{item.freq}</span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-3.5 border-t border-white/5 text-xs">
                          <div className="space-y-2">
                            <span className="text-[12px] text-on-surface-variant/60 font-black tracking-wider uppercase block">AI 检测现状</span>
                            <p className="text-xs md:text-[13px] text-on-surface-variant/85 leading-relaxed font-semibold">{item.metric}</p>
                          </div>
                          <div className="space-y-2">
                            <span className="text-[12px] text-tertiary font-black tracking-wider uppercase block">配套消灭方案</span>
                            <p className="text-xs md:text-[13px] text-on-surface-variant/85 leading-relaxed font-semibold">{item.solution}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Right Column: AI Coach Dashboard overview */}
                  <div className="col-span-12 md:col-span-4 flex flex-col gap-6">
                    <div className="glass-panel p-6 rounded-3xl border-white/10 space-y-5.5 h-full">
                      <div>
                        <h4 className="text-base font-black text-white flex items-center gap-2">
                          <span className="material-symbols-outlined text-base text-primary">psychology</span>
                          长期记忆学习路径
                        </h4>
                        <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">Agent 建议重点攻克的三条防御路径</p>
                      </div>

                      <div className="space-y-4">
                        {[
                          { step: "第一阶段: 话术纠偏", desc: "在回答中强行注入‘在系统选型中我做过以下Trade-off对比...’的转折表达。", ok: true },
                          { step: "第二阶段: 指标背诵", desc: "整理个人项目2-3组核心的测试吞吐/并发指标线，做到提及即条件反射。", ok: false },
                          { step: "第三阶段: 架构推演", desc: "绘制核心方案的主从/双写链路拓扑，加深多级组件交互流向记忆。", ok: false }
                        ].map((s, i) => (
                          <div key={i} className="flex gap-3.5">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                              s.ok ? "bg-tertiary/20 text-tertiary border border-tertiary/30" : "bg-white/5 text-on-surface-variant/40 border border-white/10"
                            }`}>
                              <span className="material-symbols-outlined text-[10px]">{s.ok ? "done" : "circle"}</span>
                            </div>
                            <div className="space-y-1 text-left">
                              <h5 className="text-sm font-black text-white">{s.step}</h5>
                              <p className="text-xs text-on-surface-variant/70 leading-relaxed font-semibold">{s.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={handleInterceptAction}
                        className="w-full py-3.5 bg-gradient-to-r from-primary to-secondary text-on-primary text-sm font-black rounded-2xl hover:scale-[1.01] active:scale-98 transition-all shadow-lg shadow-primary/20 cursor-pointer"
                      >
                        加入弱点专项强化实训
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ========================================================
                  TAB PANEL 6: GROWTH TRAJECTORY (成长轨迹演变)
                 ======================================================== */}
              {activeTab === "growth" && (
                <div className="glass-panel p-8 rounded-3xl border-white/10 w-full text-left space-y-6">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-lg font-black text-white flex items-center gap-2">
                        <span className="material-symbols-outlined text-base text-primary">trending_up</span>
                        能力成长曲线
                      </h3>
                      <p className="text-xs text-on-surface-variant/40 font-semibold mt-0.5">
                        {growthMode === "recent"
                          ? `基于最近 ${Math.min(growthTotal, 6)} 次面试分析的能力维度趋势`
                          : `基于全部 ${growthTotal} 次面试分析的能力维度趋势`}
                      </p>
                    </div>
                    {/* 最近六次 / 全部 切换 */}
                    <div className="flex bg-white/5 rounded-xl border border-white/10 p-0.5 shrink-0">
                      <button
                        onClick={() => setGrowthMode("recent")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                          growthMode === "recent"
                            ? "bg-primary text-on-primary shadow-md shadow-primary/10"
                            : "text-on-surface-variant/60 hover:text-white"
                        }`}
                      >
                        最近六次
                      </button>
                      <button
                        onClick={() => setGrowthMode("all")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                          growthMode === "all"
                            ? "bg-primary text-on-primary shadow-md shadow-primary/10"
                            : "text-on-surface-variant/60 hover:text-white"
                        }`}
                      >
                        全部
                      </button>
                    </div>
                  </div>

                  {/* 统计卡片 —— 动态计算（跟随模式过滤） */}
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4 pb-6 border-b border-white/5">
                    {(() => {
                      const filteredPoints = growthMode === "recent" ? growthPoints.slice(-6) : growthPoints;
                      const avg = (key: string) => {
                        if (filteredPoints.length === 0) return "—";
                        const sum = filteredPoints.reduce((s, p) => s + (p.scores[key as keyof typeof p.scores] ?? 0), 0);
                        return Math.round(sum / filteredPoints.length).toString();
                      };
                      return [
                        { label: "细节深度均分", value: avg("expression") },
                        { label: "逻辑自洽均分", value: avg("logic") },
                        { label: "业务理解均分", value: avg("project_depth") },
                        { label: "数据指标均分", value: avg("ownership") },
                        { label: "技术广度均分", value: avg("system_design") },
                      ].map((card, i) => (
                        <div key={i} className="p-4 rounded-2xl bg-white/[0.01] border border-white/5 space-y-1.5">
                          <span className="text-[12px] text-on-surface-variant/50 font-extrabold uppercase">{card.label}</span>
                          <h4 className="text-2xl font-black text-white font-label-mono">{card.value}</h4>
                        </div>
                      ));
                    })()}
                  </div>

                  {/* 全尺寸能力成长曲线图 */}
                  <div className="w-full h-[300px]">
                    {isLoadingGrowth ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      </div>
                    ) : (
                      <GrowthCurveChart
                        points={growthPoints}
                        axisLabels={growthAxisLabels}
                        onPointClick={handleGrowthPointClick}
                        mode={growthMode}
                      />
                    )}
                  </div>

                  {growthTotal > 0 && (
                    <p className="text-[11px] text-on-surface-variant/30 font-semibold text-center">
                      {growthMode === "recent"
                        ? `共 ${Math.min(growthTotal, 6)} / ${growthTotal} 次面试分析 · X 轴按分析次数排列 · 鼠标悬停查看详情 · 点击跳转报告`
                        : `共 ${growthTotal} 次面试分析 · X 轴按分析次数排列 · 鼠标悬停查看详情 · 点击跳转报告`}
                    </p>
                  )}
                </div>
              )}

              {/* ========================================================
                  TAB PANEL 7: AI CAREER ADVISOR (交互顾问面板)
                 ======================================================== */}
              {activeTab === "advisor" && (
                <div className="flex flex-col md:flex-row gap-6 w-full text-left items-stretch flex-1 min-h-0 h-full overflow-hidden">
                  {/* Left chatbot panel — real interactive */}
                  <div className="w-full md:flex-[8] flex flex-col flex-1 min-h-0">
                    <div className="glass-panel p-6 rounded-3xl border-white/10 flex flex-col flex-1 w-full relative min-h-0 overflow-hidden">
                      <CounselorPanel
                        key={counselorSessionKey}
                        variant="compact"
                        stats={counselorStats}
                        remaining={counselorRemaining}
                        setRemaining={setCounselorRemaining}
                        autoSendPrompt={counselorAutoSendPrompt}
                        onClearAutoSendPrompt={() => setCounselorAutoSendPrompt(null)}
                        currentSessionId={counselorSessionId}
                        setCurrentSessionId={setCounselorSessionId}
                        sessions={counselorSessions}
                        setSessions={setCounselorSessions}
                        loadSessions={loadCounselorSessions}
                        loadSession={loadCounselorSession}
                        newSession={newCounselorSession}
                        messages={counselorMessages}
                        setMessages={setCounselorMessages}
                        input={counselorInput}
                        setInput={setCounselorInput}
                        streaming={counselorStreaming}
                        setStreaming={setCounselorStreaming}
                        pending={counselorPending}
                        setPending={setCounselorPending}
                        handleDeleteSession={handleDeleteCounselorSession}
                      />
                    </div>
                  </div>

                  {/* Right side strategies column */}
                  <div className="w-full md:flex-[4] flex flex-col gap-6 justify-between flex-1 min-h-0">
                    {/* Widget 1: 能力数据来源 */}
                    <div className="glass-panel p-5 rounded-3xl border-white/10 space-y-4 text-left flex-1 flex flex-col justify-center">
                      <div>
                        <h4 className="text-base font-black text-white flex items-center gap-2">
                          <span className="material-symbols-outlined text-base text-primary">data_usage</span>
                          能力数据来源
                        </h4>
                      </div>
                      <div className="space-y-3.5 border-b border-white/5 pb-4 flex-1 flex flex-col justify-center">
                        {[
                          { label: "面试分析", val: `${counselorStats?.interview_count ?? historyItems.filter(item => item.type === "audio" || item.type === "text" || item.type === "live").length} 次`, icon: "analytics" },
                          { label: "简历分析", val: `${counselorStats?.resume_count ?? 3} 次`, icon: "description" },
                          { label: "项目记忆", val: `${counselorStats?.project_count ?? projectTotal} 个`, icon: "folder_shared" },
                          { label: "时间跨度", val: `${counselorStats?.experience_years ?? "1个月"}`, icon: "schedule" }
                        ].map((stat, i) => (
                          <div key={i} className="flex justify-between items-center text-sm font-semibold">
                            <span className="text-on-surface-variant/80 flex items-center gap-2">
                              <span className="material-symbols-outlined text-sm text-primary/60">{stat.icon}</span>
                              {stat.label}
                            </span>
                            <span className="text-white font-black font-label-mono">{stat.val}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => handleTabChange("timeline")}
                        className="text-sm text-primary hover:text-primary/80 font-black flex items-center gap-1 mt-1 cursor-pointer transition-colors shrink-0"
                      >
                        查看数据详情 <span className="material-symbols-outlined text-sm">arrow_right_alt</span>
                      </button>
                    </div>

                    {/* Widget 2: 使用建议 */}
                    <div className="glass-panel p-5 rounded-3xl border-white/10 space-y-4 text-left flex-1 flex flex-col justify-center">
                      <div>
                        <h4 className="text-base font-black text-white flex items-center gap-2">
                          <span className="material-symbols-outlined text-base text-primary">tips_and_updates</span>
                          使用建议
                        </h4>
                      </div>
                      <div className="space-y-3 flex-1 flex flex-col justify-center">
                        {[
                          { text: "具体问题能获得更精准的建议", icon: "lightbulb" },
                          { text: "结合自身情况理性参考", icon: "handshake" },
                          { text: "定期回顾会话获得持续提升", icon: "loop" }
                        ].map((item, i) => (
                          <div key={i} className="flex items-start gap-2.5 text-sm font-semibold leading-relaxed text-on-surface-variant/80">
                            <span className="material-symbols-outlined text-sm text-primary shrink-0 mt-0.5">{item.icon}</span>
                            <span>{item.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Widget 3: 隐私保护 */}
                    <div className="glass-panel p-5 rounded-3xl border-white/10 space-y-4 text-left flex-1 flex flex-col justify-center">
                      <div>
                        <h4 className="text-base font-black text-white flex items-center gap-2">
                          <span className="material-symbols-outlined text-base text-tertiary">shield</span>
                          隐私保护
                        </h4>
                      </div>
                      <div className="flex gap-3 items-start p-3 bg-tertiary/5 rounded-xl border border-tertiary/10">
                        <span className="material-symbols-outlined text-lg text-tertiary shrink-0 mt-0.5">verified_user</span>
                        <p className="text-sm text-on-surface-variant/70 leading-relaxed font-semibold">
                          你的所有对话内容仅存储在本地，我们不会将任何信息用于其他用途。
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* ========================================================
              BOTTOM AI CAREER ADVISOR STRATEGY BAR
             ======================================================== */}
          {activeTab !== "advisor" && (
            <div className="glass-panel p-6 rounded-3xl border-white/10 relative overflow-hidden text-left flex flex-col gap-6 shadow-2xl w-full">
              {/* Background glowing particles */}
              <div className="absolute top-1/2 left-6 -translate-y-1/2 w-28 h-28 bg-primary/10 rounded-full blur-2xl pointer-events-none animate-pulse"></div>

              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-4 border-b border-white/5 relative z-10">
                <div className="flex items-center gap-3">
                  {/* AI Agent Avatar core */}
                  <div className="relative">
                    <div className="w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 shadow-[0_0_15px_rgba(192,193,255,0.2)]">
                      <span className="material-symbols-outlined text-xl text-primary animate-pulse">support_agent</span>
                    </div>
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-tertiary border-2 border-background"></span>
                  </div>
                  <div>
                    <h4 className="text-base font-black text-white">AI 职业顾问</h4>
                    <p className="text-xs text-on-surface-variant/60 font-semibold mt-0.5">基于你所有的面试记录和分析，AI 为你定制建议</p>
                  </div>
                </div>

                <button
                  onClick={() => handleTabChange("advisor", true)}
                  className="px-5 py-2.5 bg-primary text-on-primary text-sm font-black rounded-xl hover:scale-[1.02] active:scale-98 transition-all shadow-[0_4px_15px_rgba(192,193,255,0.3)] cursor-pointer"
                >
                  咨询 AI 顾问
                </button>
              </div>

              {/* AI Advisor Columns */}
              {(() => {
                const getPrompt = (text: string, moduleKey: string) => {
                  switch (text) {
                    case "架构表达框架建立":
                      return "我想了解关于『架构表达框架建立』的建议。在面试中，我该如何系统地向面试官展现我的架构设计表达框架？";
                    case "项目指标定量细化":
                      return "我想了解如何进行『项目指标定量细化』？如何发掘简历中项目的核心量化指标，在面试中表现出强有力的数据说服力？";
                    case "系统设计 trade-off 表达":
                      return "我想了解在面试中关于『系统设计 trade-off 表达』的深度建议。怎样阐述技术选型时的权衡（trade-off）才显得成熟和严谨？";
                    case "系统设计出现频率上升 23%":
                      return "我看到近期面试趋势中『系统设计出现频率上升了23%』，AI 顾问对此有什么深度洞察或高频考点预测吗？";
                    case "分布式相关问题增加明显":
                      return "我注意到『分布式相关问题增加明显』这一趋势，在近期的面试准备中，有哪些分布式系统的关键难点和高频考点我需要着重补齐？";
                    case "面试官更关注工程落地细节":
                      return "关于『面试官更关注工程落地细节』这一趋势，我应该如何在面试中生动具体地描述我的工程落地细节和难题攻关过程？";
                    case "完成 3 次真题模拟面试":
                      return "我想进行『完成 3 次真题模拟面试』这一行动。AI 顾问能否根据我的技术背景，推荐一些适合我的真题，并指导我如何高效进行模拟面试？";
                    case "优化 2 个核心项目描述":
                      return "关于『优化 2 个核心项目描述』这一推荐行动，我该如何利用 AI 来修改和突出我的项目难点、技术架构与业务成果？";
                    case "补充架构师深度表达训练":
                      return "我想了解如何进行『补充架构师深度表达训练』？有哪些核心的话术框架或者思维模型可以帮助我在面试中展示出架构师的深度和格局？";
                    case "建议向 Staff Engineer 方向准备":
                      return "AI 顾问建议我『向 Staff Engineer 方向准备』，能为我详细分析一下我当前能力与 Staff Engineer 之间的 Gap，以及我接下来中长期的成长路线图吗？";
                    case "提升技术影响力和领导力表达":
                      return "我该如何提升我的『技术影响力和领导力表达』？在面试或者日常工作中，如何展示我的技术影响力和技术领导力（Leadership）？";
                    case "密切关注一线大厂架构能力变化":
                      return "对于『密切关注一线大厂架构能力变化』，近期一线大厂对架构师/高级工程师的架构能力标准有哪些新的变化和核心技术要求？";
                  }

                  switch (moduleKey) {
                    case "focus_areas":
                      return `作为我的 AI 职业顾问，我希望针对『${text}』这个重点提升维度获得系统性的学习与面试通关建议。在面试中，我应该如何向面试官系统性地展现这一能力，避免在这一块暴露短板？`;
                    case "interview_trends":
                      return `关于近期面试趋势中提及的『${text}』，我希望深入了解：当前公司在这一维度的核心考察偏好是什么？为了应对这一趋势，有哪些典型高频面试真题与考点我需要着重补齐？`;
                    case "recommended_actions":
                      return `在 AI 职业顾问推荐我的行动建议中，有一项是『${text}』。我该如何高效地执行这一项行动？你能为我提供一套具体的、可实操落地的计划和执行步骤吗？`;
                    case "career_suggestions":
                      return `我的 AI 职业顾问为我拟定了职业发展建议：『${text}』。能为我详细分析一下这对我中长期职业路径的意义吗？如果我想朝这个方向进阶，我该如何系统地建立核心竞争力和工作中的技术影响力？`;
                    default:
                      return `我想咨询关于『${text}』的相关建议。`;
                  }
                };

                const isGenerating = advisorInsights === null || advisorInsights.status === "generating";

                if (isGenerating) {
                  return (
                    <div className="flex flex-col gap-6 w-full relative z-10">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {[
                          { title: "本周重点提升", color: "primary" },
                          { title: "近期面试趋势", color: "secondary" },
                          { title: "推荐行动", color: "warning" },
                          { title: "职业发展建议", color: "tertiary" },
                        ].map((card, cardIdx) => (
                          <div 
                            key={cardIdx} 
                            className="glass-panel p-5.5 rounded-2xl border-white/10 flex flex-col gap-3 animate-pulse"
                          >
                            <div className="flex items-center gap-2.5 pb-2.5 border-b border-white/5">
                              <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 shrink-0" />
                              <span className="text-sm font-black text-white/50 font-label-mono uppercase tracking-wider block">
                                {card.title}
                              </span>
                            </div>
                            <div className="space-y-3 mt-2">
                              {[1, 2, 3].map((itemIdx) => (
                                <div 
                                  key={itemIdx} 
                                  className="h-11 w-full rounded-xl bg-white/[0.02] border border-white/5 flex items-center px-4"
                                >
                                  <div className="h-2.5 w-4/5 rounded bg-white/10" />
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Guidance banner in loading state */}
                      <div className="glass-panel py-3.5 px-6 rounded-2xl border-white/5 bg-white/[0.02] flex items-center justify-between gap-4 flex-wrap w-full">
                        <div className="flex items-center gap-2.5 text-xs md:text-sm font-semibold text-on-surface-variant/60">
                          <span className="material-symbols-outlined text-amber-500/80 text-lg animate-spin">sync</span>
                          <span>AI 正在为您生成专属顾问建议，请稍候...</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                const focusAreas = advisorInsights?.focus_areas || [];
                const interviewTrends = advisorInsights?.interview_trends || [];
                const recommendedActions = advisorInsights?.recommended_actions || [];
                const careerSuggestions = advisorInsights?.career_suggestions || [];

                return (
                  <div className="flex flex-col gap-6 w-full relative z-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                      
                      {/* Card 1: 本周重点提升 */}
                      <div className="glass-panel p-5.5 rounded-2xl border-white/10 flex flex-col gap-3 hover:border-primary/20 hover:scale-[1.01] transition-all duration-300">
                        <div className="flex items-center gap-2.5 pb-2.5 border-b border-white/5">
                          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
                            <span className="material-symbols-outlined text-base text-primary animate-pulse">rocket_launch</span>
                          </div>
                          <span className="text-sm font-black text-white font-label-mono uppercase tracking-wider block">本周重点提升</span>
                        </div>
                        <div className="space-y-2 mt-1">
                          {focusAreas.map((text, i) => (
                            <div 
                              key={i} 
                              onClick={() => askAdvisor(getPrompt(text, "focus_areas"))}
                              className="flex items-center gap-3 py-2.5 px-3.5 rounded-xl bg-white/[0.01] hover:bg-white/[0.03] active:scale-[0.98] border border-white/5 hover:border-primary/25 hover:text-primary transition-all text-xs md:text-sm font-black text-on-surface-variant/90 text-left cursor-pointer select-none group"
                            >
                              <span className="material-symbols-outlined text-xs text-primary shrink-0 transition-transform group-hover:translate-x-0.5">arrow_right_alt</span>
                              <span className="leading-snug">{text}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Card 2: 近期面试趋势 */}
                      <div className="glass-panel p-5.5 rounded-2xl border-white/10 flex flex-col gap-3 hover:border-secondary/20 hover:scale-[1.01] transition-all duration-300">
                        <div className="flex items-center gap-2.5 pb-2.5 border-b border-white/5">
                          <div className="w-8 h-8 rounded-xl bg-secondary/10 flex items-center justify-center border border-secondary/20 shrink-0">
                            <span className="material-symbols-outlined text-base text-secondary animate-pulse">trending_up</span>
                          </div>
                          <span className="text-sm font-black text-white font-label-mono uppercase tracking-wider block">近期面试趋势</span>
                        </div>
                        <div className="space-y-2 mt-1">
                          {interviewTrends.map((text, i) => (
                            <div 
                              key={i} 
                              onClick={() => askAdvisor(getPrompt(text, "interview_trends"))}
                              className="flex items-center gap-3 py-2.5 px-3.5 rounded-xl bg-white/[0.01] hover:bg-white/[0.03] active:scale-[0.98] border border-white/5 hover:border-secondary/25 hover:text-secondary transition-all text-xs md:text-sm font-black text-on-surface-variant/90 text-left cursor-pointer select-none group"
                            >
                              <span className="material-symbols-outlined text-xs text-secondary shrink-0 transition-transform group-hover:scale-110">insights</span>
                              <span className="leading-snug">{text}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Card 3: 推荐行动 */}
                      <div className="glass-panel p-5.5 rounded-2xl border-white/10 flex flex-col gap-3 hover:border-amber-500/20 hover:scale-[1.01] transition-all duration-300">
                        <div className="flex items-center gap-2.5 pb-2.5 border-b border-white/5">
                          <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 shrink-0">
                            <span className="material-symbols-outlined text-base text-amber-500 animate-pulse">task_alt</span>
                          </div>
                          <span className="text-sm font-black text-white font-label-mono uppercase tracking-wider block">推荐行动</span>
                        </div>
                        <div className="space-y-2 mt-1">
                          {recommendedActions.map((text, i) => (
                            <div 
                              key={i} 
                              onClick={() => askAdvisor(getPrompt(text, "recommended_actions"))}
                              className="flex items-center gap-3 py-2.5 px-3.5 rounded-xl bg-white/[0.01] hover:bg-white/[0.03] active:scale-[0.98] border border-white/5 hover:border-amber-500/25 hover:text-amber-500 transition-all text-xs md:text-sm font-black text-on-surface-variant/90 text-left cursor-pointer select-none group"
                            >
                              <span className="material-symbols-outlined text-xs text-amber-500 shrink-0 transition-transform group-hover:rotate-12">play_circle</span>
                              <span className="leading-snug">{text}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Card 4: 职业发展建议 */}
                      <div className="glass-panel p-5.5 rounded-2xl border-white/10 flex flex-col gap-3 hover:border-tertiary/20 hover:scale-[1.01] transition-all duration-300">
                        <div className="flex items-center gap-2.5 pb-2.5 border-b border-white/5">
                          <div className="w-8 h-8 rounded-xl bg-tertiary/10 flex items-center justify-center border border-tertiary/20 shrink-0">
                            <span className="material-symbols-outlined text-base text-tertiary animate-pulse">military_tech</span>
                          </div>
                          <span className="text-sm font-black text-white font-label-mono uppercase tracking-wider block">职业发展建议</span>
                        </div>
                        <div className="space-y-2 mt-1">
                          {careerSuggestions.map((text, i) => (
                            <div 
                              key={i} 
                              onClick={() => askAdvisor(getPrompt(text, "career_suggestions"))}
                              className="flex items-center gap-3 py-2.5 px-3.5 rounded-xl bg-white/[0.01] hover:bg-white/[0.03] active:scale-[0.98] border border-white/5 hover:border-tertiary/25 hover:text-tertiary transition-all text-xs md:text-sm font-black text-on-surface-variant/90 text-left cursor-pointer select-none group"
                            >
                              <span className="material-symbols-outlined text-xs text-tertiary shrink-0 transition-transform group-hover:scale-110">explore</span>
                              <span className="leading-snug">{text}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>

                    {/* Fallback Guidance Banner */}
                    {(advisorInsights === null || advisorInsights.is_customized === false) && (
                      <div className="glass-panel py-3.5 px-6 rounded-2xl border-white/5 bg-white/[0.02] flex items-center justify-between gap-4 flex-wrap w-full animate-fade-in">
                        <div className="flex items-center gap-2.5 text-xs md:text-sm font-semibold text-on-surface-variant/80">
                          <span className="material-symbols-outlined text-amber-500 text-lg animate-pulse">lightbulb</span>
                          <span>
                            当前展示为【<span className="text-white font-bold">{advisorInsights?.target_role || (auth.user && auth.user.targetRole) || "高级工程师"}</span>】行业通用基准建议。只需{" "}
                            <button 
                              onClick={() => router.push("/debugger")} 
                              className="text-primary hover:underline font-extrabold bg-transparent border-none p-0 cursor-pointer inline-block"
                            >
                              进行 1 次面试分析或简历分析
                            </button>{" "}
                            或{" "}
                            <button 
                              onClick={() => router.push("/training")} 
                              className="text-primary hover:underline font-extrabold bg-transparent border-none p-0 cursor-pointer inline-block"
                            >
                              完成 1 次模拟面试
                            </button>
                            ，即可解锁 AI 定制化专属建议！
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

        </div>

      </div>

      {/* Footer */}
      <footer className="bg-surface-container-lowest border-t border-white/5 w-full block mt-8 relative z-10">
        <div className="px-gutter py-8 max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-left">
          <div className="flex items-center gap-4">
            <span className="text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">
              © 2026 面试VAR AI. All rights reserved.
            </span>
          </div>
          <div className="flex gap-8 text-xs text-on-surface-variant font-label-mono font-bold tracking-widest">
            <a onClick={() => router.push("/")} className="hover:text-primary transition-colors cursor-pointer">
              返回主页
            </a>
            <a className="hover:text-primary transition-colors cursor-default" href="#">
              隐私政策
            </a>
            <a className="hover:text-primary transition-colors cursor-default" href="#">
              服务条款
            </a>
          </div>
        </div>
      </footer>

      {/* WECHAT MODAL */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            onClick={() => setShowLoginModal(false)}
            className="absolute inset-0 bg-surface/60 backdrop-blur-md transition-opacity duration-300"
          />

          <div className="bg-surface-container-high border border-white/10 rounded-3xl p-8 max-w-sm w-full text-center relative z-10 space-y-6 shadow-2xl transition-all scale-100 animate-fade-in">
            <div className="flex justify-between items-center">
              <span className="font-label-mono text-[10px] text-primary tracking-widest uppercase font-bold">
                面试VAR Intelligence
              </span>
              <button
                onClick={() => setShowLoginModal(false)}
                className="text-on-surface-variant hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-2">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-2 animate-bounce">
                <span className="material-symbols-outlined text-2.5xl">lock</span>
              </div>
              <h3 className="font-extrabold text-white text-lg">保存分析结果与成长轨迹</h3>
              <p className="text-on-surface-variant text-xs leading-relaxed max-w-xs mx-auto font-semibold">
                注册并登录账号，即可保存本次分析历史、下载修改好的简历并追踪您的面试成长路径。
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <button
                onClick={() => setShowLoginModal(false)}
                className="w-full py-3.5 rounded-xl bg-tertiary text-on-tertiary font-bold text-xs hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-tertiary/15"
              >
                <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                  chat
                </span>
                使用微信一键登录
              </button>
              <button
                onClick={() => setShowLoginModal(false)}
                className="w-full py-3.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold text-xs hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">phone_iphone</span>
                手机号验证码登录
              </button>
            </div>

            <p className="text-[10px] text-on-surface-variant/40">登录即代表您已阅读并同意《服务条款》和《隐私政策》</p>
          </div>
        </div>
      )}

{/* KNOWLEDGE BASE DETAIL MODAL */}
      {selectedKnowledge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 lg:p-8">
          <div
            onClick={closeKnowledgeModal}
            className="absolute inset-0 bg-background/80 backdrop-blur-md transition-opacity duration-300"
          />

          <div className="relative z-10 w-full max-w-6xl h-[85vh] bg-[#11131a]/95 border border-white/10 rounded-3xl p-6 sm:p-8 flex flex-col gap-6 shadow-2xl transition-all scale-100 animate-fade-in animate-duration-200 overflow-hidden">
            {/* Close button */}
            <button
              onClick={closeKnowledgeModal}
              className="absolute top-5 right-5 text-on-surface-variant/70 hover:text-white transition-colors cursor-pointer w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>

            {knowledgeLoading ? (
              /* Loading view */
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
                <img src="/loading.gif" alt="loading" className="w-10 h-10 object-contain" />
                <p className="text-sm text-on-surface-variant/70 font-semibold animate-pulse">
                  AI 正在深度检索该知识点的 Top10 面试高频问题与解析...
                </p>
              </div>
            ) : (
              /* Details view */
              <>
                {/* Header section */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-4 border-b border-white/5 shrink-0">
                  <div className="space-y-2">
                    <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-primary/20 text-primary border border-primary/30">
                      {selectedKnowledge.cat}
                    </span>
                    <h3 className="text-xl md:text-2xl font-black text-white flex items-center gap-2">
                      {selectedKnowledge.name}
                    </h3>
                  </div>
                </div>

                {/* Tab layout section */}
                <div className="flex border-b border-white/5 pb-2 shrink-0">
                  <button className="px-4 py-2 border-b-2 border-primary text-sm font-bold text-white flex items-center gap-1.5 cursor-pointer">
                    面试高频问题 Top10
                  </button>
                </div>

                {/* Main Split Grid container */}
                {(() => {
                  const questions = getQuestionsForKnowledge(selectedKnowledge.name);
                  const activeQuestion = questions[selectedQuestionIdx] || questions[0];
                  
                  return (
                    <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 gap-6 overflow-hidden">
                      {/* Left list pane: questions list */}
                      <div className="col-span-12 md:col-span-5 flex flex-col gap-3 h-full overflow-hidden">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-on-surface-variant/50 uppercase tracking-widest shrink-0">
                          <span className="material-symbols-outlined text-sm text-primary">star</span>
                          面试高频问题 Top10
                        </div>
                        <div className="flex-1 overflow-y-auto pr-2 space-y-2 scrollbar-thin scrollbar-thumb-white/10">
                          {questions.map((q, qidx) => {
                            const isQActive = selectedQuestionIdx === qidx;
                            const numStr = String(qidx + 1).padStart(2, '0');
                            return (
                              <div
                                key={qidx}
                                onClick={() => setSelectedQuestionIdx(qidx)}
                                className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all duration-200 ${
                                  isQActive
                                    ? "bg-primary/10 border-primary/30 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] scale-[1.01]"
                                    : "bg-white/[0.01] border-white/5 hover:bg-white/5 hover:border-white/10 text-on-surface-variant/80 hover:text-white"
                                }`}
                              >
                                <div className="flex items-start gap-3 min-w-0 flex-1">
                                  <span className="font-mono text-xs font-bold text-primary shrink-0 mt-0.5">{numStr}</span>
                                  <span className="text-xs md:text-sm font-bold truncate pr-2 text-left">{q.title}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right details pane: AI recommended answer */}
                      <div className="col-span-12 md:col-span-7 flex flex-col gap-3 h-full overflow-hidden">
                        <div className="flex items-center justify-between shrink-0">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-on-surface-variant/50 uppercase tracking-widest">
                            <span className="material-symbols-outlined text-sm text-primary">psychology</span>
                            AI 推荐回答
                          </div>
                        </div>

                        {/* Scrolling answers details */}
                        <div className="flex-1 overflow-y-auto pr-2 space-y-4 scrollbar-thin scrollbar-thumb-white/10 text-left">
                          {/* Core Answer Strategy */}
                          <div className="p-4.5 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                            <h4 className="text-xs md:text-sm font-black text-white flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm text-primary">lightbulb</span>
                              核心回答思路
                            </h4>
                            <p className="text-xs md:text-sm text-on-surface-variant/80 font-semibold leading-relaxed">
                              {activeQuestion.aiAnswer.core}
                            </p>
                          </div>

                          {/* Reference Answer - STAR structure */}
                          <div className="p-4.5 rounded-2xl bg-white/[0.01] border border-white/5 space-y-4">
                            <h4 className="text-xs md:text-sm font-black text-white flex items-center gap-1.5 border-b border-white/5 pb-2">
                              <span className="material-symbols-outlined text-sm text-primary">layers</span>
                              参考回答（STAR 结构）
                            </h4>
                            
                            <div className="space-y-3.5">
                              <div className="space-y-1">
                                <span className="text-primary font-bold text-[10px] md:text-xs uppercase tracking-wide block">S Situation（场景）</span>
                                <p className="text-xs md:text-sm text-on-surface-variant/80 font-semibold leading-relaxed">
                                  {activeQuestion.aiAnswer.s}
                                </p>
                              </div>
                              
                              <div className="space-y-1">
                                <span className="text-primary font-bold text-[10px] md:text-xs uppercase tracking-wide block">T Task（任务）</span>
                                <p className="text-xs md:text-sm text-on-surface-variant/80 font-semibold leading-relaxed">
                                  {activeQuestion.aiAnswer.t}
                                </p>
                              </div>
                              
                              <div className="space-y-1">
                                <span className="text-primary font-bold text-[10px] md:text-xs uppercase tracking-wide block">A Action（行动）</span>
                                <ul className="list-disc list-inside text-xs md:text-sm text-on-surface-variant/80 font-semibold leading-relaxed space-y-1">
                                  {activeQuestion.aiAnswer.a.map((action, aidx) => (
                                    <li key={aidx}>{action}</li>
                                  ))}
                                </ul>
                              </div>
                              
                              <div className="space-y-1">
                                <span className="text-tertiary font-bold text-[10px] md:text-xs uppercase tracking-wide block">R Result（结果）</span>
                                <p className="text-xs md:text-sm text-on-surface-variant/80 font-semibold leading-relaxed">
                                  {activeQuestion.aiAnswer.r}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Key Summaries & Follow-ups */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 space-y-2">
                              <h5 className="text-xs md:text-sm font-bold text-white flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs text-primary">bookmark</span>
                                关键点总结
                              </h5>
                              <ul className="list-disc list-inside text-xs text-on-surface-variant/80 font-semibold space-y-1.5">
                                {activeQuestion.aiAnswer.keyPoints.map((pt, pidx) => (
                                  <li key={pidx}>{pt}</li>
                                ))}
                              </ul>
                            </div>
                            
                            <div className="p-4 rounded-2xl bg-tertiary/5 border border-tertiary/10 space-y-2">
                              <h5 className="text-xs md:text-sm font-bold text-white flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs text-tertiary">contact_support</span>
                                可能的追问
                              </h5>
                              <ul className="list-disc list-inside text-xs text-on-surface-variant/80 font-semibold space-y-1.5">
                                {activeQuestion.aiAnswer.followUps.map((up, uidx) => (
                                  <li key={uidx}>{up}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {/* DOUBLE CONFIRMATION MODAL */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            onClick={() => {
              if (!isDeleting) {
                setShowConfirmModal(false);
                setDeleteTarget(null);
              }
            }}
            className="absolute inset-0 bg-surface/60 backdrop-blur-md transition-opacity duration-300"
          />

          <div className="bg-surface-container-high border border-white/10 rounded-3xl p-8 max-w-md w-full text-center relative z-10 space-y-6 shadow-2xl transition-all scale-100 animate-fade-in animate-duration-200">
            <div className="flex justify-between items-center">
              <span className="font-label-mono text-[10px] text-red-400 tracking-widest uppercase font-bold">
                Danger Zone
              </span>
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setDeleteTarget(null);
                }}
                className="text-on-surface-variant hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-2">
              <div className="w-16 h-16 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mx-auto mb-2">
                <span className="material-symbols-outlined" style={{ fontSize: "40px" }}>warning</span>
              </div>
              <h3 className="font-extrabold text-white text-2xl">确认要删除吗？</h3>
              <p className="text-on-surface-variant text-sm leading-relaxed max-w-xs mx-auto font-semibold">
                {deleteTarget === "batch"
                  ? `您已选择批量删除 ${selectedIds.length} 条面试分析记录，此操作将永久删除关联的对象存储音频文件和数据库分析报告，且不可撤销。`
                  : deleteTarget === "counselor-batch"
                    ? `您已选择批量删除 ${selectedCounselorIds.length} 个会话，此操作不可撤销。`
                    : typeof deleteTarget === "string" && deleteTarget.startsWith("counselor-")
                      ? "此操作将永久删除该会话，且不可撤销。"
                      : deleteTarget && typeof deleteTarget === "string" && deleteTarget.startsWith("project-")
                        ? "此操作将永久删除该项目记忆记录，且不可撤销。"
                        : "此操作将永久删除此面试分析记录，以及关联的对象存储音频文件和数据库分析报告，且不可撤销。"}
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setDeleteTarget(null);
                }}
                className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-base font-bold hover:bg-white/10 transition-all cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white text-base font-bold hover:bg-red-600 transition-all cursor-pointer shadow-lg shadow-red-500/15"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PROJECT DETAILS MODAL */}
      {selectedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 select-none">
          {/* Backdrop blur */}
          <div
            onClick={() => setSelectedProject(null)}
            className="absolute inset-0 bg-[#050B1A]/80 backdrop-blur-md transition-opacity duration-300"
          />

          {/* Modal Container */}
          <div className="bg-[#0b1326] border border-white/10 rounded-3xl p-6 md:p-8 max-w-2xl w-full relative z-10 space-y-6 shadow-2xl transition-all scale-100 animate-fade-in animate-duration-200 text-left max-h-[85vh] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent select-text">
            {/* Header */}
            <div className="flex justify-between items-start border-b border-white/5 pb-4">
              <div className="space-y-1 pr-6">
                <span className="px-2.5 py-1 rounded bg-primary/10 text-primary text-[11px] font-black border border-primary/20">
                  {selectedProject.category}
                </span>
                <h3 className="font-black text-white text-xl md:text-2xl mt-2 leading-tight">
                  {selectedProject.project_name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedProject(null)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-on-surface-variant/40 hover:text-white flex items-center justify-center border border-white/5 transition-all cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Content Body */}
            <div className="space-y-5">
              {/* Info Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4.5 rounded-2xl bg-white/[0.01] border border-white/5 text-xs">
                <div className="space-y-1">
                  <span className="text-on-surface-variant/40 font-bold block">担任角色</span>
                  <span className="text-white font-extrabold">{selectedProject.role || "核心开发者"}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-on-surface-variant/40 font-bold block">项目周期</span>
                  <span className="text-white font-extrabold">{selectedProject.duration || "暂无信息"}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-on-surface-variant/40 font-bold block">面试提及</span>
                  <span className="text-primary font-black font-label-mono">{selectedProject.mention_count} 次</span>
                </div>
                <div className="space-y-1">
                  <span className="text-on-surface-variant/40 font-bold block">最近提及</span>
                  <span className="text-white font-extrabold text-xs leading-tight">
                    {selectedProject.last_mentioned_summary || "尚未提及"}
                  </span>
                </div>
              </div>

              {/* Summary */}
              {selectedProject.summary && (
                <div className="space-y-2">
                  <span className="text-xs font-label-mono text-primary font-bold uppercase tracking-wider block">项目摘要</span>
                  <p className="text-sm text-on-surface-variant/80 leading-relaxed font-medium bg-white/[0.01] border border-white/5 rounded-2xl p-4 max-h-[150px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent pr-1.5">
                    {selectedProject.summary}
                  </p>
                </div>
              )}

              {/* Full Description */}
              {selectedProject.description && (
                <div className="space-y-2">
                  <span className="text-xs font-label-mono text-primary font-bold uppercase tracking-wider block">详细描述</span>
                  <p className="text-sm text-on-surface-variant/80 leading-relaxed font-medium bg-white/[0.01] border border-white/5 rounded-2xl p-4 whitespace-pre-wrap max-h-[150px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent pr-1.5">
                    {selectedProject.description}
                  </p>
                </div>
              )}

              {/* Tech Stack */}
              {selectedProject.tech_stack && selectedProject.tech_stack.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-label-mono text-primary font-bold uppercase tracking-wider block">技术栈</span>
                  <div className="flex flex-wrap gap-2">
                    {selectedProject.tech_stack.map((tech: string, i: number) => (
                      <span key={i} className="px-3 py-1 rounded-full bg-white/5 text-on-surface-variant/70 text-xs font-bold border border-white/5">
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer Action */}
            <div className="flex justify-end pt-4 border-t border-white/5">
              <button
                onClick={() => setSelectedProject(null)}
                className="px-6 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-black cursor-pointer hover:scale-[1.01] active:scale-98 transition-all shadow-lg shadow-primary/20"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LOADING OVERLAY */}
      {isDeleting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-surface/80 backdrop-blur-md">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
            <div className="absolute inset-0 rounded-full border-4 border-t-primary animate-spin" />
          </div>
          <p className="text-sm font-bold text-white tracking-wider animate-pulse">删除中，请稍候...</p>
        </div>
      )}

      {/* UNAUTHENTICATED OVERLAY */}
      {!auth.isLoggedIn && (
        <div className="fixed inset-0 z-30 bg-background/55 backdrop-blur-md flex items-center justify-center px-4">
          <div className="glass-panel relative rounded-3xl border border-white/10 p-8 sm:p-10 max-w-md w-full text-center space-y-6 shadow-[0_20px_60px_rgba(0,0,0,0.4)] overflow-hidden">
            <div className="absolute -top-16 -right-16 w-40 h-40 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-16 -left-16 w-40 h-40 bg-secondary/15 rounded-full blur-3xl pointer-events-none" />

            <div className="relative space-y-5">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center shadow-[0_0_30px_rgba(192,193,255,0.2)]">
                <span className="material-symbols-outlined text-3xl text-primary">lock</span>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-label-mono tracking-widest text-primary font-bold uppercase block">
                  Career Memory
                </span>
                <h3 className="text-2xl font-black text-white leading-tight">登录解锁你的职业记忆看板</h3>
                <p className="text-sm text-on-surface-variant/70 font-semibold leading-relaxed">
                  AI 长期记忆会持续学习你的面试表现，沉淀项目亮点、追踪技能波动，并生成定制化的成长轨迹与 Offer 概率预测。
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                <button
                  onClick={() => auth.setShowLogin(true)}
                  className="flex-1 py-3 bg-primary text-on-primary font-black rounded-xl hover:scale-[1.02] active:scale-95 transition-all shadow-[0_0_24px_rgba(192,193,255,0.35)] cursor-pointer"
                >
                  立即登录
                </button>
                <button
                  onClick={() => router.push("/register")}
                  className="flex-1 py-3 bg-white/5 border border-white/10 text-white font-black rounded-xl hover:bg-white/10 transition-all cursor-pointer"
                >
                  免费注册
                </button>
              </div>

              <button
                onClick={() => router.push("/")}
                className="text-base font-bold text-on-surface-variant/50 hover:text-on-surface-variant transition-colors cursor-pointer"
              >
                返回首页
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
