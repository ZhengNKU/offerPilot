import math
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, or_, desc, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app import models, schemas
from app.database import get_db

router = APIRouter(prefix="/api/guide", tags=["Interview Guide"])


async def check_and_seed_featured_guides(db: AsyncSession):
    """确保数据库中仅保留 1 条真实预置数据 (初始阅读量、点赞量、收藏量均为 0)。"""
    res = await db.execute(select(models.FeaturedGuide))
    items = res.scalars().all()

    # 如果数据库不恰好为 1 条或者标题不符，进行重置
    if len(items) != 1 or items[0].title != "在仙林参加了一场AI产品的分享会":
        await db.execute(delete(models.FeaturedGuide))
        await db.commit()

        real_item = models.FeaturedGuide(
            id=1,
            title="在仙林参加了一场AI产品的分享会",
            cover_img="/guide/test.jpg",
            platform="小红书",
            platform_badge_bg="bg-[#FF2442]/20 text-[#FF2442] border-[#FF2442]/30",
            duration="图文笔记",
            url="https://www.xiaohongshu.com/user/profile/6799a1aa000000000e010b91/6a2f6eed0000000006021c5c?xsec_token=ABzPxAe_7shsbeXRUnRFatFieduaK2Nxat4Ijb1sTp3E8=&xsec_source=pc_user",
            author="",
            author_avatar="",
            author_verified=False,
            category="推荐",
            reads=0,
            likes=0,
            favorites=0,
        )
        db.add(real_item)
        await db.commit()


@router.get("/featured", response_model=schemas.FeaturedGuidePageOut)
async def get_featured_guides(
    page: int = Query(1, ge=1, description="当前页码"),
    page_size: int = Query(8, ge=1, le=50, description="每页条数（默认8条）"),
    search: Optional[str] = Query(None, description="搜索关键词"),
    sort_by: Optional[str] = Query("latest", description="排序规则: latest, likes, favs, reads"),
    db: AsyncSession = Depends(get_db)
):
    """获取精选推荐列表 (仅包含 1 条真实预置数据)"""
    await check_and_seed_featured_guides(db)

    stmt = select(models.FeaturedGuide)

    # 搜索过滤
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                models.FeaturedGuide.title.ilike(q),
                models.FeaturedGuide.category.ilike(q),
                models.FeaturedGuide.platform.ilike(q)
            )
        )

    # 计数
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_res = await db.execute(count_stmt)
    total = total_res.scalar() or 0

    # 排序
    if sort_by == "likes":
        stmt = stmt.order_by(desc(models.FeaturedGuide.likes))
    elif sort_by == "favs":
        stmt = stmt.order_by(desc(models.FeaturedGuide.favorites))
    elif sort_by == "reads":
        stmt = stmt.order_by(desc(models.FeaturedGuide.reads))
    else:
        stmt = stmt.order_by(models.FeaturedGuide.id.asc())

    # 分页
    offset = (page - 1) * page_size
    stmt = stmt.offset(offset).limit(page_size)

    res = await db.execute(stmt)
    items = res.scalars().all()

    total_pages = math.ceil(total / page_size) if total > 0 else 1

    guide_outs = [
        schemas.FeaturedGuideOut(
            id=str(item.id),
            title=item.title,
            cover_img=item.cover_img,
            platform=item.platform,
            platform_badge_bg=item.platform_badge_bg,
            duration=item.duration,
            url=item.url,
            author=item.author or "",
            author_avatar=item.author_avatar or "",
            author_verified=item.author_verified or False,
            category=item.category,
            reads=item.reads,
            likes=item.likes,
            favorites=item.favorites
        )
        for item in items
    ]

    return schemas.FeaturedGuidePageOut(
        items=guide_outs,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages
    )


@router.post("/featured/{guide_id}/like")
async def like_guide(guide_id: int, db: AsyncSession = Depends(get_db)):
    """点赞精选文章/视频"""
    guide = await db.get(models.FeaturedGuide, guide_id)
    if not guide:
        raise HTTPException(status_code=404, detail="文章未找到")
    guide.likes += 1
    await db.commit()
    await db.refresh(guide)
    return {"id": str(guide.id), "likes": guide.likes}


@router.post("/featured/{guide_id}/favorite")
async def favorite_guide(guide_id: int, db: AsyncSession = Depends(get_db)):
    """收藏精选文章/视频"""
    guide = await db.get(models.FeaturedGuide, guide_id)
    if not guide:
        raise HTTPException(status_code=404, detail="文章未找到")
    guide.favorites += 1
    await db.commit()
    await db.refresh(guide)
    return {"id": str(guide.id), "favorites": guide.favorites}


@router.post("/featured/{guide_id}/read")
async def read_guide(guide_id: int, db: AsyncSession = Depends(get_db)):
    """增加文章/视频阅读量"""
    guide = await db.get(models.FeaturedGuide, guide_id)
    if not guide:
        raise HTTPException(status_code=404, detail="文章未找到")
    guide.reads += 1
    await db.commit()
    await db.refresh(guide)
    return {"id": str(guide.id), "reads": guide.reads}
