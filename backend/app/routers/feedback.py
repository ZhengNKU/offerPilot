from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import models, schemas
from app.database import get_db
from app.routers.auth import get_current_user, get_current_user_optional

router = APIRouter(prefix="/api/feedback", tags=["Feedback"])


def get_relative_time_str(dt: datetime) -> str:
    now = datetime.now()
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    delta = now - dt
    if delta.days > 30:
        return dt.strftime("%Y-%m-%d")
    elif delta.days > 0:
        return f"{delta.days}天前"
    elif delta.seconds > 3600:
        return f"{delta.seconds // 3600}小时前"
    elif delta.seconds > 60:
        return f"{delta.seconds // 60}分钟前"
    else:
        return "刚刚"


def truncate_name(name: str) -> str:
    if len(name) > 10:
        return name[:10] + "..."
    return name


async def check_and_seed_feedbacks(db: AsyncSession):
    # Check if empty
    res = await db.execute(select(models.Feedback))
    if res.scalars().first() is not None:
        return

    # Seed mock data
    mock_data = [
        {
            "title": "希望增加面试问题的难度选择",
            "description": "在模拟面试时，可以根据求职者的经验和目标岗位选择初级、中级、高级难度",
            "author_name": "张同学",
            "type": "功能建议",
            "status": "已采纳",
            "upvotes": 128,
            "comments": [
                {"author_name": "张同学", "avatar": "/debugger-2.jpg", "content": "同感，目前直接给的难度有些时候太难了。"},
                {"author_name": "李同学", "avatar": "/debugger-1.jpg", "content": "希望能快点上线这个功能，特别需要！"},
                {"author_name": "王同学", "avatar": "/debugger-2.jpg", "content": "高级难度的深度最好能对标大厂的专家级架构面试。"}
            ]
        },
        {
            "title": "AI 回答分析有时不够准确",
            "description": "在分析我的回答时，有些技术点没有识别出来，希望优化识别算法",
            "author_name": "李同学",
            "type": "问题反馈",
            "status": "处理中",
            "upvotes": 96,
            "comments": [
                {"author_name": "周同学", "avatar": "/debugger-1.jpg", "content": "对的，特别是涉及特定冷门技术框架时，AI会解释偏。"},
                {"author_name": "吴同学", "avatar": "/debugger-2.jpg", "content": "希望能够自定义专业名词库，让 AI 更好地针对性分析。"}
            ]
        },
        {
            "title": "希望支持更多行业的面试题库",
            "description": "目前主要是互联网行业，希望增加金融、制造业等行业的题库",
            "author_name": "王同学",
            "type": "功能建议",
            "status": "已计划",
            "upvotes": 78,
            "comments": [
                {"author_name": "郑同学", "avatar": "/debugger-2.jpg", "content": "想看金融量化分析岗位的面试题！"},
                {"author_name": "孙同学", "avatar": "/debugger-1.jpg", "content": "制造业的项目管理 and 质量控制面试题也希望能涵盖。"}
            ]
        },
        {
            "title": "界面可以更简洁一些",
            "description": "部分页面信息有点多，希望可以优化布局，突出重点内容",
            "author_name": "陈同学",
            "type": "体验优化",
            "status": "处理中",
            "upvotes": 65,
            "comments": [
                {"author_name": "胡同学", "avatar": "/debugger-1.jpg", "content": "确实，第一次用稍微找了一下入口。"},
                {"author_name": "林同学", "avatar": "/debugger-2.jpg", "content": "总览看板的视觉可以做得更有科技感、呼吸感一些。"}
            ]
        },
        {
            "title": "希望增加简历优化的具体建议",
            "description": "简历分析结果太笼统，希望能给出更具体的优化建议",
            "author_name": "赵同学",
            "type": "功能建议",
            "status": "已采纳",
            "upvotes": 42,
            "comments": [
                {"author_name": "马同学", "avatar": "/debugger-2.jpg", "content": "非常赞同，现在的修改建议偏话术，缺具体的技术项目提炼。"},
                {"author_name": "朱同学", "avatar": "/debugger-1.jpg", "content": "希望可以直接给出修改前后的对比段落样例。"}
            ]
        }
    ]

    for item in mock_data:
        fb = models.Feedback(
            title=item["title"],
            description=item["description"],
            author_name=item["author_name"],
            type=item["type"],
            status=item["status"],
            upvotes=item["upvotes"]
        )
        db.add(fb)
        await db.flush()  # to get fb.id
        
        for c in item["comments"]:
            comment = models.FeedbackComment(
                feedback_id=fb.id,
                author_name=c["author_name"],
                author_avatar=c["avatar"],
                content=c["content"]
            )
            db.add(comment)

    await db.commit()


@router.get("", response_model=schemas.FeedbackListResponse)
async def list_feedbacks(
    type: Optional[str] = None,
    sort: str = "latest",
    page: int = 1,
    page_size: int = 10,
    search: Optional[str] = None,
    user_only: bool = False,
    current_user: Optional[models.User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db)
):
    await check_and_seed_feedbacks(db)
    from sqlalchemy import func, or_

    # Build query
    query = select(models.Feedback).options(
        selectinload(models.Feedback.comments)
    )

    if type and type != "全部":
        query = query.where(models.Feedback.type == type)

    if user_only and current_user:
        query = query.where(models.Feedback.user_id == current_user.id)

    if search:
        query = query.where(
            or_(
                models.Feedback.title.ilike(f"%{search}%"),
                models.Feedback.description.ilike(f"%{search}%")
            )
        )

    # Count total items matching
    count_query = select(func.count(models.Feedback.id))
    if type and type != "全部":
        count_query = count_query.where(models.Feedback.type == type)
    if user_only and current_user:
        count_query = count_query.where(models.Feedback.user_id == current_user.id)
    if search:
        count_query = count_query.where(
            or_(
                models.Feedback.title.ilike(f"%{search}%"),
                models.Feedback.description.ilike(f"%{search}%")
            )
        )

    total_res = await db.execute(count_query)
    total = total_res.scalar_one()

    # Apply sorting and pagination
    if sort == "popular":
        query = query.order_by(models.Feedback.upvotes.desc(), models.Feedback.created_at.desc())
    else:
        query = query.order_by(models.Feedback.created_at.desc())

    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    feedbacks = result.scalars().all()

    # Get user votes if logged in
    user_voted_ids = set()
    if current_user:
        votes_res = await db.execute(
            select(models.FeedbackVote.feedback_id)
            .where(models.FeedbackVote.user_id == current_user.id)
        )
        user_voted_ids = set(votes_res.scalars().all())

    items = []
    for fb in feedbacks:
        comments_list = []
        for c in fb.comments:
            comments_list.append(
                schemas.FeedbackCommentResponse(
                    author=truncate_name(c.author_name),  # Truncate user name to 10 chars if exceeded
                    avatar=c.author_avatar or "/debugger-2.jpg",
                    content=c.content,
                    created_at=get_relative_time_str(c.created_at)
                )
            )

        items.append(
            schemas.FeedbackResponse(
                id=fb.id,
                title=fb.title,
                description=fb.description,
                author=fb.author_name,
                type=fb.type,
                module=fb.module,
                screenshot_url=fb.screenshot_url,
                status=fb.status,
                upvotes=fb.upvotes,
                time=get_relative_time_str(fb.created_at),
                commentsCount=len(fb.comments),
                hasVoted=fb.id in user_voted_ids,
                comments=comments_list
            )
        )

    return schemas.FeedbackListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size
    )


@router.post("", response_model=schemas.FeedbackResponse)
async def create_feedback(
    req: schemas.FeedbackCreate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Create feedback
    fb = models.Feedback(
        title=req.title,
        description=req.description,
        user_id=current_user.id,
        author_name=current_user.username,
        type=req.type,
        module=req.module,
        screenshot_url=req.screenshot_url,
        status="处理中",
        upvotes=0
    )
    db.add(fb)
    await db.commit()

    return schemas.FeedbackResponse(
        id=fb.id,
        title=fb.title,
        description=fb.description,
        author=fb.author_name,
        type=fb.type,
        module=fb.module,
        screenshot_url=fb.screenshot_url,
        status=fb.status,
        upvotes=0,
        time="刚刚",
        commentsCount=0,
        hasVoted=False,
        comments=[]
    )


@router.post("/{id}/vote")
async def toggle_vote(
    id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Check feedback
    res = await db.execute(select(models.Feedback).where(models.Feedback.id == id))
    fb = res.scalars().first()
    if not fb:
        raise HTTPException(status_code=404, detail="反馈不存在")

    # Check vote
    vote_res = await db.execute(
        select(models.FeedbackVote)
        .where(models.FeedbackVote.feedback_id == id)
        .where(models.FeedbackVote.user_id == current_user.id)
    )
    vote = vote_res.scalars().first()

    if vote:
        # Remove vote
        await db.delete(vote)
        fb.upvotes = max(0, fb.upvotes - 1)
        has_voted = False
    else:
        # Add vote
        new_vote = models.FeedbackVote(feedback_id=id, user_id=current_user.id)
        db.add(new_vote)
        fb.upvotes += 1
        has_voted = True

    await db.commit()
    return {"hasVoted": has_voted, "upvotes": fb.upvotes}


@router.post("/{id}/comment", response_model=schemas.FeedbackCommentResponse)
async def add_comment(
    id: int,
    req: schemas.CommentCreate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Check feedback
    res = await db.execute(select(models.Feedback).where(models.Feedback.id == id))
    fb = res.scalars().first()
    if not fb:
        raise HTTPException(status_code=404, detail="反馈不存在")

    avatar_url = None
    if current_user.profile:
        avatar_url = current_user.profile.avatar_url

    # Truncate user name to 10 chars if exceeded (backend level safety)
    comment_author = truncate_name(current_user.username)

    comment = models.FeedbackComment(
        feedback_id=id,
        user_id=current_user.id,
        author_name=current_user.username,  # Store original username, but truncate when displayed
        author_avatar=avatar_url,
        content=req.content
    )
    db.add(comment)
    await db.commit()

    return schemas.FeedbackCommentResponse(
        author=comment_author,
        avatar=avatar_url or "/debugger-2.jpg",
        content=comment.content,
        created_at="刚刚"
    )


from pydantic import BaseModel
class BatchDeleteRequest(BaseModel):
    ids: List[int]

@router.delete("/{id}")
async def delete_feedback(
    id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    from sqlalchemy import delete
    query = select(models.Feedback).where(models.Feedback.id == id)
    res = await db.execute(query)
    fb = res.scalar_one_or_none()
    if not fb:
        raise HTTPException(status_code=404, detail="反馈不存在")
    
    # Check if current user is the author
    if fb.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权删除他人的反馈")
    
    # Delete associated screenshot from COS and database
    if fb.screenshot_url:
        from app.routers.file import delete_file_from_storage
        file_res = await db.execute(select(models.UploadedFile).where(models.UploadedFile.file_url == fb.screenshot_url))
        db_file = file_res.scalars().first()
        if db_file:
            await delete_file_from_storage(db, db_file)

    # Delete associated votes, comments
    await db.execute(delete(models.FeedbackVote).where(models.FeedbackVote.feedback_id == id))
    await db.execute(delete(models.FeedbackComment).where(models.FeedbackComment.feedback_id == id))
    await db.delete(fb)
    await db.commit()
    return {"message": "删除成功"}


@router.post("/batch-delete")
async def batch_delete_feedbacks(
    req: BatchDeleteRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    from sqlalchemy import delete
    if not req.ids:
        raise HTTPException(status_code=400, detail="未指定删除的反馈ID")
    
    # Fetch feedbacks matching the IDs and user_id to ensure permission
    query = select(models.Feedback).where(
        models.Feedback.id.in_(req.ids),
        models.Feedback.user_id == current_user.id
    )
    res = await db.execute(query)
    fbs = res.scalars().all()
    
    if not fbs:
        raise HTTPException(status_code=400, detail="无可删除的反馈")
    
    matched_ids = [fb.id for fb in fbs]
    
    # Delete associated screenshots from COS and database
    from app.routers.file import delete_file_from_storage
    for fb in fbs:
        if fb.screenshot_url:
            file_res = await db.execute(select(models.UploadedFile).where(models.UploadedFile.file_url == fb.screenshot_url))
            db_file = file_res.scalars().first()
            if db_file:
                await delete_file_from_storage(db, db_file)

    # Delete associated votes, comments
    await db.execute(delete(models.FeedbackVote).where(models.FeedbackVote.feedback_id.in_(matched_ids)))
    await db.execute(delete(models.FeedbackComment).where(models.FeedbackComment.feedback_id.in_(matched_ids)))
    
    # Delete feedbacks
    for fb in fbs:
        await db.delete(fb)
    
    await db.commit()
    return {"message": f"成功删除 {len(matched_ids)} 条反馈", "deleted_ids": matched_ids}
