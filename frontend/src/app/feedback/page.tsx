"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, UserMenu } from "@/components/AuthProvider";

const buildPageList = (cur: number, total: number): (number | "…")[] => {
  if (total <= 1) return [1];
  const pages: (number | "…")[] = [1];
  const start = Math.max(2, cur - 1);
  const end = Math.min(total - 1, cur + 1);
  if (start > 2) pages.push("…");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("…");
  pages.push(total);
  return pages;
};

interface CommentItem {
  author: string;
  avatar: string;
  content: string;
}

interface FeedbackItem {
  id: number;
  title: string;
  description: string;
  author: string;
  type: "问题反馈" | "功能建议" | "体验优化" | "其他";
  status: "已采纳" | "处理中" | "已计划";
  upvotes: number;
  time: string;
  commentsCount: number;
  hasVoted?: boolean;
  comments: CommentItem[];
  screenshot_url?: string;
  module?: string;
}

const initialFeedbacks: FeedbackItem[] = [
  {
    id: 1,
    title: "希望增加面试问题的难度选择",
    description: "在模拟面试时，可以根据求职者的经验和目标岗位选择初级、中级、高级难度",
    author: "张同学",
    type: "功能建议",
    status: "已采纳",
    upvotes: 128,
    time: "2小时前",
    commentsCount: 12,
    comments: [
      { author: "张同学", avatar: "/debugger-2.jpg", content: "同感，目前直接给的难度有些时候太难了。" },
      { author: "李同学", avatar: "/debugger-1.jpg", content: "希望能快点上线这个功能，特别需要！" },
      { author: "王同学", avatar: "/debugger-2.jpg", content: "高级难度的深度最好能对标大厂的专家级架构面试。" }
    ]
  },
  {
    id: 2,
    title: "AI 回答分析有时不够准确",
    description: "在分析我的回答时，有些技术点没有识别出来，希望优化识别算法",
    author: "李同学",
    type: "问题反馈",
    status: "处理中",
    upvotes: 96,
    time: "5小时前",
    commentsCount: 8,
    comments: [
      { author: "周同学", avatar: "/debugger-1.jpg", content: "对的，特别是涉及特定冷门技术框架时，AI会解释偏。" },
      { author: "吴同学", avatar: "/debugger-2.jpg", content: "希望能够自定义专业名词库，让 AI 更好地针对性分析。" }
    ]
  },
  {
    id: 3,
    title: "希望支持更多行业的面试题库",
    description: "目前主要是互联网行业，希望增加金融、制造业等行业的题库",
    author: "王同学",
    type: "功能建议",
    status: "已计划",
    upvotes: 78,
    time: "1天前",
    commentsCount: 15,
    comments: [
      { author: "郑同学", avatar: "/debugger-2.jpg", content: "想看金融量化分析岗位的面试题！" },
      { author: "孙同学", avatar: "/debugger-1.jpg", content: "制造业的项目管理 and 质量控制面试题也希望能涵盖。" }
    ]
  },
  {
    id: 4,
    title: "界面可以更简洁一些",
    description: "部分页面信息有点多，希望可以优化布局，突出重点内容",
    author: "陈同学",
    type: "体验优化",
    status: "处理中",
    upvotes: 65,
    time: "1天前",
    commentsCount: 6,
    comments: [
      { author: "胡同学", avatar: "/debugger-1.jpg", content: "确实，第一次用稍微找了一下入口。" },
      { author: "林同学", avatar: "/debugger-2.jpg", content: "总览看板的视觉可以做得更有科技感、呼吸感一些。" }
    ]
  },
  {
    id: 5,
    title: "希望增加简历优化的具体建议",
    description: "简历分析结果太笼统，希望能给出更具体的优化建议",
    author: "赵同学",
    type: "功能建议",
    status: "已采纳",
    upvotes: 42,
    time: "2天前",
    commentsCount: 9,
    comments: [
      { author: "马同学", avatar: "/debugger-2.jpg", content: "非常赞同，现在的修改建议偏话术，缺具体的技术项目提炼。" },
      { author: "朱同学", avatar: "/debugger-1.jpg", content: "希望可以直接给出修改前后的对比段落样例。" }
    ]
  }
];

export default function FeedbackPage() {
  const router = useRouter();
  const auth = useAuth();

  // State Management
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [activeTab, setActiveTab] = useState<string>("全部");
  const [sortBy, setSortBy] = useState<"latest" | "popular">("latest");
  const [filterStatuses, setFilterStatuses] = useState<string[]>(["已采纳", "处理中", "已计划"]);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const totalPages = Math.ceil(totalItems / 10);

  // Deletion & Selection States
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | "batch" | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form States
  const [feedbackType, setFeedbackType] = useState("");
  const [targetModule, setTargetModule] = useState("");
  const [feedbackTitle, setFeedbackTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [showModuleDropdown, setShowModuleDropdown] = useState(false);

  // Upload States
  const [uploadFile, setUploadFile] = useState<{ name: string; size: string; progress: number } | null>(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const uploadTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Comment Modal States
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);
  const [newCommentText, setNewCommentText] = useState("");

  // Select Options
  const typeOptions = ["问题反馈", "功能建议", "体验优化", "其他"];
  const moduleOptions = ["面试调试器", "职业记忆看板", "面试训练场", "职业驾驶舱", "登录与账号", "其他"];

  // Handle outside dropdown clicks
  useEffect(() => {
    const handleOutsideClick = () => {
      setShowTypeDropdown(false);
      setShowModuleDropdown(false);
    };
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  const fetchFeedbacks = async () => {
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      let url = `http://localhost:8001/api/feedback?sort=${sortBy}&page=${currentPage}&page_size=10`;
      if (activeTab === "我的反馈") {
        url += `&user_only=true`;
      } else if (activeTab !== "全部") {
        url += `&type=${encodeURIComponent(activeTab)}`;
      }
      if (searchQuery.trim()) {
        url += `&search=${encodeURIComponent(searchQuery.trim())}`;
      }
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data)) {
          setFeedbacks(data);
          setTotalItems(data.length);
        } else if (data && data.items) {
          setFeedbacks(data.items || []);
          setTotalItems(data.total || 0);
        } else {
          setFeedbacks([]);
          setTotalItems(0);
        }
      }
    } catch (err) {
      console.error("Failed to fetch feedbacks:", err);
    }
  };

  useEffect(() => {
    fetchFeedbacks();
  }, [activeTab, sortBy, currentPage, searchQuery]);

  // Reset page to 1 on tab or sort or search query change
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds([]); // Clear selection when activeTab or query changes
  }, [activeTab, sortBy, searchQuery]);

  // Deletion and Selection Helpers
  const handleSelectRow = (id: number) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === (filteredFeedbacks || []).length) {
      setSelectedIds([]);
    } else {
      setSelectedIds((filteredFeedbacks || []).map(f => f.id));
    }
  };

  const handleDeleteConfirm = async () => {
    try {
      setIsDeleting(true);
      const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      if (deleteTarget === "batch") {
        const res = await fetch("http://localhost:8001/api/feedback/batch-delete", {
          method: "POST",
          headers,
          body: JSON.stringify({ ids: selectedIds }),
        });
        if (res.ok) {
          auth.triggerToast("批量删除成功");
          setSelectedIds([]);
        } else {
          auth.triggerToast("批量删除失败");
        }
      } else if (typeof deleteTarget === "number") {
        const res = await fetch(`http://localhost:8001/api/feedback/${deleteTarget}`, {
          method: "DELETE",
          headers,
        });
        if (res.ok) {
          auth.triggerToast("删除成功");
          setSelectedIds(prev => prev.filter(x => x !== deleteTarget));
        } else {
          auth.triggerToast("删除失败");
        }
      }
    } catch (err) {
      console.error("Failed to delete feedback:", err);
      auth.triggerToast("删除操作失败");
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      fetchFeedbacks();
    }
  };

  // Filter & Sort Logic
  const filteredFeedbacks = feedbacks || [];

  // Upvote Action
  const handleUpvote = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auth.isLoggedIn) {
      auth.triggerToast("请先登录再点赞！");
      return;
    }
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
      const res = await fetch(`http://localhost:8001/api/feedback/${id}/vote`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json(); // { hasVoted, upvotes }
        setFeedbacks(prev =>
          prev.map(item => {
            if (item.id === id) {
              return {
                ...item,
                hasVoted: data.hasVoted,
                upvotes: data.upvotes
              };
            }
            return item;
          })
        );
        if (selectedFeedback && selectedFeedback.id === id) {
          setSelectedFeedback(prev => prev ? {
            ...prev,
            hasVoted: data.hasVoted,
            upvotes: data.upvotes
          } : null);
        }
      }
    } catch (err) {
      console.error("Failed to toggle vote:", err);
    }
  };

  // Form Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.isLoggedIn) {
      auth.triggerToast("请先登录再提交反馈！");
      return;
    }
    if (!feedbackType || !targetModule || !feedbackTitle.trim() || !content.trim()) {
      auth.triggerToast("请填写必填项！");
      return;
    }

    setIsSubmitting(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
      const res = await fetch("http://localhost:8001/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          title: feedbackTitle.trim(),
          description: content.trim(),
          type: feedbackType,
          module: targetModule,
          screenshot_url: uploadedFileUrl || null
        })
      });
      if (res.ok) {
        const newFeedback = await res.json();
        setFeedbacks(prev => [newFeedback, ...prev]);
        setShowSuccessModal(true);
        // Reset Form
        setFeedbackType("");
        setTargetModule("");
        setFeedbackTitle("");
        setContent("");
        setUploadedFileUrl("");
        setUploadFile(null);
      } else {
        const errorData = await res.json();
        auth.triggerToast(errorData.detail || "提交失败，请重试！");
      }
    } catch (err) {
      console.error("Failed to submit feedback:", err);
      auth.triggerToast("提交失败，请检查网络！");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Real File Upload to Object Storage (COS)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!feedbackType) {
      auth.triggerToast("请先选择反馈类型！");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      auth.triggerToast("图片不能超过 5MB！");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const fileSizeStr = (file.size / (1024 * 1024)).toFixed(2) + " MB";
    setIsUploading(true);
    setUploadFile({ name: file.name, size: fileSizeStr, progress: 5 });

    // Generate custom renamed file: Username-YYYYMMDD-HHMMSS-FeedbackType.ext
    const ext = file.name.split('.').pop() || "png";
    const username = auth.user?.name || "anonymous";
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    const timeStr = `${year}${month}${day}-${hour}${minute}${second}`;
    const customFilename = `${username}-${timeStr}-${feedbackType}.${ext}`;
    const renamedFile = new File([file], customFilename, { type: file.type });

    const formData = new FormData();
    formData.append("file", renamedFile);
    formData.append("file_type", "screenshot");

    const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "http://localhost:8001/api/file/upload");
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        setUploadFile(prev => prev ? { ...prev, progress: Math.max(5, percentComplete) } : null);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const response = JSON.parse(xhr.responseText);
          setUploadedFileUrl(response.file_url);
          setUploadFile(prev => prev ? { ...prev, progress: 100 } : null);
          setIsUploading(false);
          auth.triggerToast("截图上传成功！");
        } catch (err) {
          auth.triggerToast("解析上传响应失败！");
          setUploadFile(null);
          setIsUploading(false);
        }
      } else {
        auth.triggerToast("截图上传失败！");
        setUploadFile(null);
        setIsUploading(false);
      }
    };

    xhr.onerror = () => {
      auth.triggerToast("网络错误，截图上传失败！");
      setUploadFile(null);
      setIsUploading(false);
    };

    xhr.send(formData);
  };

  const removeUploadFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setUploadFile(null);
    setUploadedFileUrl("");
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Add Comment
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.isLoggedIn) {
      auth.triggerToast("请先登录再发表评论！");
      return;
    }
    if (!newCommentText.trim() || !selectedFeedback) return;

    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("interviewVar_token") : null;
      const res = await fetch(`http://localhost:8001/api/feedback/${selectedFeedback.id}/comment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          content: newCommentText.trim()
        })
      });
      if (res.ok) {
        const newCommentObj = await res.json();
        // Update feedbacks list
        setFeedbacks(prev => prev.map(item => {
          if (item.id === selectedFeedback.id) {
            const updatedComments = [...item.comments, newCommentObj];
            return {
              ...item,
              comments: updatedComments,
              commentsCount: updatedComments.length
            };
          }
          return item;
        }));
        // Update selectedFeedback details
        setSelectedFeedback(prev => prev ? {
          ...prev,
          comments: [...prev.comments, newCommentObj],
          commentsCount: prev.commentsCount + 1
        } : null);
        setNewCommentText("");
      } else {
        const errorData = await res.json();
        auth.triggerToast(errorData.detail || "发表评论失败，请重试！");
      }
    } catch (err) {
      console.error("Failed to add comment:", err);
      auth.triggerToast("发表评论失败，请检查网络！");
    }
  };

  // Layout Alignment Configurations
  const workspaceHeight = "h-[980px] max-h-[980px] overflow-hidden";

  return (
    <div className="min-h-screen bg-[#0b1326] relative overflow-hidden select-none">
      
      {/* Background Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-secondary/5 blur-[120px] pointer-events-none" />

      {/* NAV BAR */}
      <nav className="relative z-20 border-b border-white/5 backdrop-blur-md bg-[#0b1326]/60">
        <div className="max-w-container-max mx-auto px-gutter h-20 flex items-center justify-between">
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
            <a onClick={() => router.push("/memory")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              职业记忆看板
            </a>
            <a onClick={() => router.push("/training")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              面试训练场
            </a>
            <a onClick={() => router.push("/home")} className="text-on-surface-variant hover:text-on-surface transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer">
              职业驾驶舱
            </a>
            <a onClick={() => router.push("/feedback")} className="text-primary transition-colors text-[16px] md:text-[17px] font-extrabold cursor-pointer relative after:content-[''] after:absolute after:bottom-[-26px] after:left-0 after:right-0 after:h-[2px] after:bg-primary">
              体验反馈中心
            </a>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/memory?tab=timeline")}
              className="px-4.5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-bold text-on-surface hover:bg-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">history</span>历史记录
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
                  onClick={() => router.push("/debugger")}
                  className="px-6 py-2 bg-primary text-on-primary font-bold rounded-full scale-95 hover:scale-100 active:scale-90 transition-all shadow-[0_0_20px_rgba(192,193,255,0.3)] hover:shadow-[0_0_30px_rgba(192,193,255,0.5)] cursor-pointer"
                >
                  免费开始
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Main Workspace Frame */}
      <div className={`flex-1 max-w-container-max mx-auto w-full px-gutter py-8 flex flex-col gap-6 relative z-10 ${workspaceHeight}`}>
        
        {/* ========================================================
            TOP BANNER: Header Title + Mockup image decoration
           ======================================================== */}
        <div className="glass-panel p-6 md:p-8 rounded-3xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.2)] h-[220px] shrink-0">
          {/* Decorative purple glows inside header */}
          <div className="absolute top-0 right-1/4 w-[150px] h-[150px] bg-primary/20 rounded-full blur-[80px]" />
          
          <div className="flex items-center gap-5 relative z-10">
            <img 
              src="/feedback-2.png" 
              alt="Feedback Icon" 
              className="w-36 h-36 object-contain shrink-0" 
            />
            <div className="text-left">
              <h1 className="text-2xl md:text-3xl font-extrabold text-on-surface">体验反馈中心</h1>
              <p className="text-sm md:text-base text-on-surface-variant mt-1.5 font-medium">
                你的反馈是我们前进的动力，帮助我们打造更好的面试VAR
              </p>
            </div>
          </div>
          
          <div className="hidden md:block relative h-full w-[240px] md:w-[320px] select-none pointer-events-none">
            <img 
              src="/feedback.jpg" 
              alt="Feedback Illustration" 
              className="absolute right-0 top-1/2 -translate-y-1/2 h-[190px] w-auto object-contain rounded-2xl" 
            />
          </div>
        </div>

        {/* ========================================================
            BOTTOM CONTENT GRID: Left (Submit Form) + Right (All Feedbacks)
           ======================================================== */}
        <div className="flex-1 min-h-0 grid grid-cols-12 gap-6 items-stretch">
          
          {/* LEFT COLUMN: Submit Feedback */}
          <div className="col-span-12 lg:col-span-4 flex flex-col min-h-0 h-full">
            <div className="glass-panel p-6 rounded-3xl border-white/10 flex flex-col flex-1 w-full relative min-h-0 overflow-y-auto">
              
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-primary text-xl">edit_square</span>
                <h2 className="text-lg font-bold text-on-surface">提交反馈</h2>
              </div>
              <p className="text-xs text-on-surface-variant text-left mb-6">告诉我们你的问题或建议</p>

              <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-5 text-left">
                
                {/* Feedback Type */}
                <div className="relative">
                  <label className="text-sm font-bold text-on-surface mb-2 block">
                    反馈类型 <span className="text-red-400">*</span>
                  </label>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTypeDropdown(!showTypeDropdown);
                      setShowModuleDropdown(false);
                    }}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/20 transition-all rounded-xl flex items-center justify-between cursor-pointer"
                  >
                    <span className={feedbackType ? "text-on-surface text-sm font-medium" : "text-on-surface-variant/50 text-sm"}>
                      {feedbackType || "请选择反馈类型"}
                    </span>
                    <span className={`material-symbols-outlined text-on-surface-variant text-base transition-transform ${showTypeDropdown ? "rotate-180" : ""}`}>
                      keyboard_arrow_down
                    </span>
                  </div>
                  
                  <AnimatePresence>
                    {showTypeDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="absolute z-30 left-0 right-0 mt-1.5 bg-[#171f33] border border-white/10 rounded-xl overflow-hidden shadow-2xl"
                      >
                        {typeOptions.map((opt) => (
                          <div
                            key={opt}
                            onClick={() => setFeedbackType(opt)}
                            className="px-4 py-3 hover:bg-white/5 text-sm text-on-surface cursor-pointer font-medium transition-colors"
                          >
                            {opt}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Target Module */}
                <div className="relative">
                  <label className="text-sm font-bold text-on-surface mb-2 block">
                    关联功能模块 <span className="text-red-400">*</span>
                  </label>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowModuleDropdown(!showModuleDropdown);
                      setShowTypeDropdown(false);
                    }}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/20 transition-all rounded-xl flex items-center justify-between cursor-pointer"
                  >
                    <span className={targetModule ? "text-on-surface text-sm font-medium" : "text-on-surface-variant/50 text-sm"}>
                      {targetModule || "请选择功能模块"}
                    </span>
                    <span className={`material-symbols-outlined text-on-surface-variant text-base transition-transform ${showModuleDropdown ? "rotate-180" : ""}`}>
                      keyboard_arrow_down
                    </span>
                  </div>

                  <AnimatePresence>
                    {showModuleDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="absolute z-30 left-0 right-0 mt-1.5 bg-[#171f33] border border-white/10 rounded-xl overflow-hidden shadow-2xl"
                      >
                        {moduleOptions.map((opt) => (
                          <div
                            key={opt}
                            onClick={() => setTargetModule(opt)}
                            className="px-4 py-3 hover:bg-white/5 text-sm text-on-surface cursor-pointer font-medium transition-colors"
                          >
                            {opt}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Feedback Title */}
                <div>
                  <label className="text-sm font-bold text-on-surface mb-2 block">
                    反馈标题 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={feedbackTitle}
                    onChange={(e) => setFeedbackTitle(e.target.value.slice(0, 100))}
                    maxLength={100}
                    placeholder="请输入反馈标题..."
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/20 focus:border-primary-container/30 transition-all rounded-xl text-sm text-on-surface placeholder-on-surface-variant/35 focus:outline-none"
                  />
                </div>

                {/* Feedback Content */}
                <div className="flex-1 flex flex-col min-h-[140px]">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-bold text-on-surface">
                      反馈内容 <span className="text-red-400">*</span>
                    </label>
                    <span className={`text-[10px] ${content.length > 300 ? "text-red-400 font-bold" : "text-on-surface-variant/40"}`}>
                      {content.length}/300
                    </span>
                  </div>
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value.slice(0, 300))}
                    maxLength={300}
                    placeholder="请详细描述你的问题或建议..."
                    className="w-full flex-1 p-4 bg-white/5 border border-white/10 hover:border-white/15 focus:border-primary-container/30 transition-all rounded-xl text-sm text-on-surface placeholder-on-surface-variant/35 resize-none focus:outline-none scrollbar-thin"
                  />
                </div>

                {/* Upload Screenshot */}
                <div>
                  <label className="text-sm font-bold text-on-surface mb-2 block">上传截图 (可选)</label>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border border-dashed border-white/15 hover:border-white/25 transition-all rounded-xl p-5 flex flex-col items-center justify-center bg-white/[0.01] hover:bg-white/[0.02] cursor-pointer relative overflow-hidden"
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="image/*"
                      className="hidden"
                    />

                    {uploadFile ? (
                      <div className="w-full text-left relative z-10" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 min-w-0 pr-4">
                            <span className="material-symbols-outlined text-primary text-lg">image</span>
                            <p className="text-xs font-medium text-on-surface truncate">{uploadFile.name}</p>
                          </div>
                          <button
                            type="button"
                            onClick={removeUploadFile}
                            className="w-5 h-5 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-on-surface-variant text-xs">close</span>
                          </button>
                        </div>
                        
                        <div className="text-[10px] text-on-surface-variant/60 mb-2">{uploadFile.size}</div>
                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-primary-container to-[#ffcbd0] transition-all duration-200" 
                            style={{ width: `${uploadFile.progress}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-on-surface-variant/40 text-[26px] mb-2">cloud_upload</span>
                        <p className="text-xs font-semibold text-on-surface">点击上传或拖拽文件到此处</p>
                        <p className="text-[10px] text-on-surface-variant/40 mt-1">支持 jpg, png, 最大 5MB</p>
                      </>
                    )}
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting || isUploading}
                  className="w-full bg-gradient-to-r from-primary-container to-[#b3b4ff] hover:opacity-90 active:scale-[0.98] transition-all text-on-primary font-bold py-3.5 px-6 rounded-xl cursor-pointer flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(128,131,255,0.25)] shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
                      <span>正在提交...</span>
                    </>
                  ) : (
                    <span>提交反馈</span>
                  )}
                </button>
              </form>

            </div>
          </div>

          {/* RIGHT COLUMN: All Feedbacks Board */}
          <div className="col-span-12 lg:col-span-8 flex flex-col min-h-0 h-full">
            <div className="glass-panel p-6 rounded-3xl border-white/10 flex flex-col flex-1 w-full relative min-h-0">
              
              {/* Header Feed Controller */}
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-xl">forum</span>
                  <h2 className="text-lg font-bold text-on-surface">全部反馈</h2>
                </div>
                
                <div className="flex items-center gap-3">
                  {/* Search Input */}
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      placeholder="搜索反馈..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                      }}
                      className="bg-white/5 border border-white/10 hover:border-white/15 focus:border-primary-container/30 transition-all px-3 pl-8 py-1.5 rounded-full text-xs font-medium text-on-surface placeholder-on-surface-variant/40 focus:outline-none w-[140px] focus:w-[190px]"
                    />
                    <span className="material-symbols-outlined text-on-surface-variant/50 text-base absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                      search
                    </span>
                    {searchQuery && (
                      <button
                        onClick={() => {
                          setSearchQuery("");
                        }}
                        className="material-symbols-outlined text-on-surface-variant/50 hover:text-on-surface text-sm absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
                      >
                        close
                      </button>
                    )}
                  </div>

                  <div className="relative">
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="appearance-none bg-white/5 border border-white/10 hover:border-white/15 px-4 pr-9 py-1.5 rounded-full text-sm font-bold text-on-surface cursor-pointer focus:outline-none"
                    >
                      <option value="latest" className="bg-[#171f33]">最新</option>
                      <option value="popular" className="bg-[#171f33]">最热</option>
                    </select>
                    <span className="material-symbols-outlined text-on-surface-variant text-sm absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      keyboard_arrow_down
                    </span>
                  </div>
                </div>
              </div>

              {/* Filtering tabs */}
              <div className="flex items-center gap-2 border-b border-white/5 pb-3 mb-5 shrink-0 overflow-x-auto scrollbar-none">
                {["全部", "问题反馈", "功能建议", "体验优化", "其他", "我的反馈"].map((tab) => {
                  const isActive = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-1.5 rounded-full text-base font-bold transition-all cursor-pointer ${
                        isActive
                          ? "bg-primary-container/20 border border-primary-container/30 text-primary"
                          : "text-on-surface-variant hover:text-on-surface"
                      }`}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>

              {/* Batch action bar (only when activeTab === "我的反馈") */}
              {activeTab === "我的反馈" && filteredFeedbacks.length > 0 && (
                <div className="flex items-center justify-between px-5 py-3 bg-white/5 border border-white/10 rounded-2xl mb-4 text-base font-bold text-on-surface-variant shrink-0">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={filteredFeedbacks.length > 0 && selectedIds.length === filteredFeedbacks.length}
                      onChange={handleSelectAll}
                      className="rounded border-white/10 text-primary focus:ring-0 focus:ring-offset-0 bg-white/5 w-4 h-4 cursor-pointer"
                    />
                    <span>全选 ({selectedIds.length}/{filteredFeedbacks.length})</span>
                  </label>
                  {selectedIds.length > 0 && (
                    <button
                      onClick={() => {
                        setDeleteTarget("batch");
                        setShowDeleteConfirm(true);
                      }}
                      className="px-3.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/25 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                      <span>批量删除</span>
                    </button>
                  )}
                </div>
              )}

              {/* Feed items list container */}
              <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin flex flex-col gap-4 text-left min-h-0">
                <AnimatePresence mode="popLayout">
                  {filteredFeedbacks.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex-1 flex flex-col items-center justify-center text-on-surface-variant/40"
                    >
                      <span className="material-symbols-outlined text-[44px] mb-3">inbox</span>
                      <p className="text-base font-bold">没有找到匹配的反馈记录</p>
                    </motion.div>
                  ) : (
                    filteredFeedbacks.map((item) => (
                      <motion.div
                        layout
                        key={item.id}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        onClick={() => setSelectedFeedback(item)}
                        className="bg-white/[0.01] hover:bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] p-5 rounded-2xl transition-all flex items-start gap-4 cursor-pointer relative group"
                      >
                        {/* Checkbox (only when activeTab === "我的反馈") */}
                        {activeTab === "我的反馈" && (
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(item.id)}
                            onChange={() => handleSelectRow(item.id)}
                            onClick={(e) => e.stopPropagation()} // Prevent opening details modal!
                            className="mt-2.5 rounded border-white/10 text-primary focus:ring-0 focus:ring-offset-0 bg-white/5 w-4.5 h-4.5 cursor-pointer shrink-0"
                          />
                        )}

                        {/* Type circle badge */}
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 border ${
                          item.type === "问题反馈" ? "bg-red-400/10 text-red-300 border-red-400/20" :
                          item.type === "功能建议" ? "bg-primary-container/10 text-primary border-primary-container/20" :
                          item.type === "体验优化" ? "bg-amber-400/10 text-amber-300 border-amber-400/20" :
                          "bg-white/5 text-on-surface-variant border-white/10"
                        }`}>
                          {item.type === "问题反馈" ? "问" :
                           item.type === "功能建议" ? "功" :
                           item.type === "体验优化" ? "体" : "其"}
                        </div>

                        {/* Text info block */}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-extrabold text-[15px] text-on-surface truncate group-hover:text-primary transition-colors">
                            {item.title}
                          </h3>
                          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed line-clamp-1">
                            {item.description}
                          </p>
                          
                          <div className="flex items-center gap-1.5 mt-3 text-[10px] text-on-surface-variant/40 font-medium">
                            <span>来自用户</span>
                            <span className="text-on-surface-variant/60 font-semibold">{item.author}</span>
                            <span>·</span>
                            <span>{item.type}</span>
                          </div>
                        </div>

                        {/* Label badges */}
                        <div className="flex flex-col items-end gap-3 self-stretch justify-between text-right shrink-0">
                          <div className="flex items-center gap-2">
                            {/* Delete button (only when activeTab === "我的反馈") */}
                            {activeTab === "我的反馈" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation(); // Prevent opening details modal!
                                  setDeleteTarget(item.id);
                                  setShowDeleteConfirm(true);
                                }}
                                className="w-7 h-7 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/15 flex items-center justify-center cursor-pointer transition-colors"
                                title="删除反馈"
                              >
                                <span className="material-symbols-outlined text-[15px]">delete</span>
                              </button>
                            )}

                            {/* Type tag */}
                            <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                              item.type === "问题反馈" ? "bg-red-400/10 text-red-300 border border-red-400/15" :
                              item.type === "功能建议" ? "bg-primary-container/10 text-primary border border-primary-container/15" :
                              item.type === "体验优化" ? "bg-amber-400/10 text-amber-300 border border-amber-400/15" :
                              "bg-white/10 text-on-surface-variant border border-white/15"
                            }`}>
                              {item.type}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-[10px] text-on-surface-variant/40 font-medium">
                            <span>{item.time}</span>
                            <div 
                              onClick={(e) => handleUpvote(item.id, e)}
                              className={`flex items-center gap-1 hover:text-primary transition-colors ${item.hasVoted ? "text-primary font-bold" : ""}`}
                            >
                              <span className="material-symbols-outlined text-xs">thumb_up</span>
                              <span>{item.upvotes}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-xs">chat_bubble</span>
                              <span>{item.commentsCount}</span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>

              {/* Pagination Footer */}
              {totalItems > 0 && (
                <div className="mt-5 pt-4 border-t border-white/5 flex items-center justify-between font-label-mono text-xs text-on-surface-variant/50 w-full select-none shrink-0">
                  <span>共 {totalItems} 条记录</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage <= 1}
                      className={`px-2.5 py-1 rounded border border-white/5 ${
                        currentPage <= 1
                          ? "bg-white/5 text-white/50 hover:bg-white/10 cursor-not-allowed"
                          : "bg-white/5 hover:bg-white/10 cursor-pointer"
                      }`}
                    >
                      &lt;
                    </button>
                    {buildPageList(currentPage, totalPages).map((p, idx) =>
                      p === "…" ? (
                        <span key={`e-${idx}`} className="px-2.5 py-1 text-on-surface-variant/40">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setCurrentPage(p)}
                          className={`px-2.5 py-1 rounded cursor-pointer ${
                            currentPage === p
                              ? "bg-primary text-on-primary font-bold"
                              : "bg-white/5 hover:bg-white/10 border border-white/5"
                          }`}
                        >
                          {p}
                        </button>
                      )
                    )}
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage >= totalPages}
                      className={`px-2.5 py-1 rounded border border-white/5 ${
                        currentPage >= totalPages
                          ? "bg-white/5 text-white/50 hover:bg-white/10 cursor-not-allowed"
                          : "bg-white/5 hover:bg-white/10 cursor-pointer"
                      }`}
                    >
                      &gt;
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>

        </div>

      </div>

      {/* ========================================================
          POPUP MODALS & DIALOG OVERLAYS
         ======================================================== */}

      {/* Form Submission Success Modal */}
      <AnimatePresence>
        {showSuccessModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="glass-panel p-8 rounded-3xl max-w-sm w-full mx-4 text-center border-white/10 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-40 bg-primary/20 rounded-full blur-[50px] pointer-events-none" />
              
              <div className="w-16 h-16 bg-emerald-400/10 border border-emerald-400/20 text-emerald-300 rounded-full flex items-center justify-center mx-auto mb-5 shadow-[0_0_20px_rgba(52,211,153,0.15)]">
                <span className="material-symbols-outlined text-xl">check_circle</span>
              </div>

              <h3 className="text-xl font-bold text-on-surface mb-2">感谢您的反馈！</h3>
              <p className="text-sm text-on-surface-variant font-medium leading-relaxed mb-6">
                您的声音对我们至关重要，产品团队会尽快评估您提交的内容。
              </p>

              <button
                onClick={() => setShowSuccessModal(false)}
                className="w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 transition-all rounded-xl text-sm font-bold text-on-surface cursor-pointer"
              >
                我知道了
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Filter Options Modal */}
      <AnimatePresence>
        {showFilterModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowFilterModal(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-panel p-6 rounded-3xl max-w-xs w-full mx-4 border-white/10 shadow-2xl"
            >
              <h3 className="text-sm font-bold text-on-surface mb-4">按状态筛选</h3>
              
              <div className="flex flex-col gap-3.5 mb-6 text-left">
                {["已采纳", "处理中", "已计划"].map((st) => {
                  const isChecked = filterStatuses.includes(st);
                  return (
                    <label key={st} className="flex items-center gap-3.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          if (isChecked) {
                            setFilterStatuses(prev => prev.filter(x => x !== st));
                          } else {
                            setFilterStatuses(prev => [...prev, st]);
                          }
                        }}
                        className="rounded border-white/10 text-primary-container focus:ring-0 focus:ring-offset-0 bg-white/5 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-xs text-on-surface font-medium">{st}</span>
                    </label>
                  );
                })}
              </div>

              <button
                onClick={() => setShowFilterModal(false)}
                className="w-full py-2.5 bg-gradient-to-r from-primary-container to-[#b3b4ff] transition-all rounded-xl text-xs font-bold text-on-primary cursor-pointer shadow-[0_4px_15px_rgba(128,131,255,0.2)] text-center"
              >
                确定
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Details & Comments Modal */}
      <AnimatePresence>
        {selectedFeedback && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelectedFeedback(null)}>
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-panel rounded-3xl max-w-2xl w-full h-[80vh] mx-4 border-white/10 shadow-2xl flex flex-col overflow-hidden"
            >
              
              {/* Header */}
              <div className="p-6 border-b border-white/5 flex items-start justify-between shrink-0 text-left">
                <div className="min-w-0 pr-4">
                  <div className="flex items-center gap-2.5 mb-2">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                      selectedFeedback.type === "问题反馈" ? "bg-red-400/10 text-red-300 border border-red-400/15" :
                      selectedFeedback.type === "功能建议" ? "bg-primary-container/10 text-primary border border-primary-container/15" :
                      selectedFeedback.type === "体验优化" ? "bg-amber-400/10 text-amber-300 border border-amber-400/15" :
                      "bg-white/10 text-on-surface-variant border border-white/15"
                    }`}>
                      {selectedFeedback.type}
                    </span>
                  </div>
                  <h3 className="font-extrabold text-base text-on-surface leading-snug">
                    {selectedFeedback.title}
                  </h3>
                </div>
                
                <button
                  onClick={() => setSelectedFeedback(null)}
                  className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center cursor-pointer transition-colors text-on-surface"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              {/* Body Content */}
              <div className="flex-1 overflow-y-auto p-6 scrollbar-thin text-left">
                
                {/* Description details */}
                <div className="mb-5 shrink-0">
                  <h4 className="text-sm font-bold text-on-surface-variant/40 mb-2">反馈详情</h4>
                  <p className="text-base text-on-surface font-medium leading-relaxed whitespace-pre-wrap">
                    {selectedFeedback.description}
                  </p>
                  <div className="text-sm text-on-surface-variant/40 font-medium mt-3.5">
                    来自用户 <span className="text-on-surface-variant/60 font-semibold">{selectedFeedback.author}</span> · {selectedFeedback.time}
                  </div>
                  {selectedFeedback.screenshot_url && (
                    <div className="mt-4 pt-4 border-t border-white/5">
                      <h4 className="text-xs font-bold text-on-surface-variant/40 mb-2">相关截图</h4>
                      <a href={selectedFeedback.screenshot_url} target="_blank" rel="noreferrer" className="inline-block max-w-full overflow-hidden rounded-xl border border-white/10 hover:border-primary/30 transition-colors">
                        <img src={selectedFeedback.screenshot_url} alt="Screenshot" className="max-h-[180px] w-auto max-w-full object-contain mx-auto" />
                      </a>
                    </div>
                  )}
                </div>

                {/* Comments area */}
                <div className="border-t border-white/5 pt-5 flex flex-col">
                  <h4 className="text-base font-bold text-on-surface mb-3 flex items-center gap-1.5 shrink-0">
                    <span>探讨与评论</span>
                    <span className="text-[10px] bg-white/5 px-1.5 py-0.5 rounded font-normal text-on-surface-variant/50">
                      {selectedFeedback.commentsCount}
                    </span>
                  </h4>
                  
                  {/* Comments Card Wrapper - scrollable card */}
                  <div className="glass-panel p-4 rounded-2xl border-white/5 bg-white/[0.01] min-h-[400px] max-h-[480px] overflow-y-auto scrollbar-thin flex flex-col gap-3 mb-2">
                    {selectedFeedback.comments.length === 0 ? (
                      <p className="text-base text-on-surface-variant/40 py-4 text-center my-auto">暂无探讨评论，来发表你的想法吧</p>
                    ) : (
                      selectedFeedback.comments.map((comment, index) => (
                        <div key={index} className="bg-white/[0.015] border border-white/[0.04] p-3 rounded-xl flex items-start gap-2.5">
                          <img 
                            src={comment.avatar || "/debugger-2.jpg"} 
                            alt={comment.author} 
                            className="w-7 h-7 rounded-full object-cover shrink-0 border border-white/10" 
                          />
                          <div className="min-w-0 flex-1">
                             <div className="flex items-center justify-between gap-2 mb-0.5">
                               <span className="text-[10px] font-bold text-on-surface-variant/75">
                                 {comment.author.length > 10 ? comment.author.slice(0, 10) + "..." : comment.author}
                               </span>
                             </div>
                             <p className="text-xs text-on-surface font-medium leading-relaxed">
                               {comment.content}
                             </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>

              {/* Add comment form - pinned at bottom */}
              <form onSubmit={handleAddComment} className="p-6 border-t border-white/5 bg-[#0f1422]/60 backdrop-blur-md flex gap-2 relative shrink-0 rounded-b-3xl">
                <input
                  type="text"
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  placeholder="写下你的想法，一起交流讨论..."
                  className="flex-1 bg-white/5 border border-white/10 hover:border-white/15 focus:border-primary-container/30 transition-all px-4 py-2.5 rounded-xl text-xs text-on-surface placeholder-on-surface-variant/30 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!newCommentText.trim()}
                  className="bg-primary text-on-primary font-bold px-4 rounded-xl text-sm hover:opacity-90 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                >
                  发布
                </button>
              </form>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 select-none">
          {/* Backdrop blur */}
          <div
            onClick={() => {
              if (!isDeleting) {
                setShowDeleteConfirm(false);
                setDeleteTarget(null);
              }
            }}
            className="absolute inset-0 bg-[#050B1A]/85 backdrop-blur-md transition-opacity duration-300"
          />

          <div className="relative glass-panel max-w-sm w-full p-6 rounded-3xl border-white/10 shadow-2xl space-y-6 text-center z-10 bg-[#0A0F1D]/90">
            <div className="flex justify-between items-center border-b border-white/5 pb-3">
              <span className="font-label-mono text-[10px] text-red-400 tracking-widest uppercase font-bold">
                Danger Zone
              </span>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteTarget(null);
                }}
                disabled={isDeleting}
                className="text-on-surface-variant hover:text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
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
                  ? `您已选择批量删除 ${selectedIds.length} 条反馈记录，此操作将永久从数据库和存储中删除这些记录，且不可撤销。`
                  : "此操作将永久删除该反馈记录，以及关联的全部评论内容，且不可撤销。"}
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteTarget(null);
                }}
                disabled={isDeleting}
                className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-base font-bold hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
              >
                取消
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white text-base font-bold hover:bg-red-600 transition-all cursor-pointer shadow-lg shadow-red-500/15 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>删除中...</span>
                  </>
                ) : (
                  <span>确认删除</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
