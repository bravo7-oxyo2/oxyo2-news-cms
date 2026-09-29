import{describe,expect,it}from'vitest'
import{ContentType}from'@cms/database'
import{contentSearchFilters,localizeContent,publicContentWhere,publicListingCountry}from'./content.js'

describe('content route filters',()=>{
  it('builds category, featured, and search filters',()=>{
    expect(contentSearchFilters({category:'Technology',categoryId:'cat_123',featured:'true',search:'AI'})).toEqual({
      categoryId:'cat_123',
      isFeatured:true,
      AND:[
        {OR:[{category:{equals:'Technology',mode:'insensitive'}},{categoryRef:{is:{slug:'Technology'}}},{categoryRef:{is:{name:{equals:'Technology',mode:'insensitive'}}}}]},
        {OR:[{title:{contains:'AI',mode:'insensitive'}},{slug:{contains:'AI',mode:'insensitive'}},{excerpt:{contains:'AI',mode:'insensitive'}},{category:{contains:'AI',mode:'insensitive'}}]}
      ]
    })
  })
  it('keeps public queries published-only',()=>{
    const now=new Date('2026-07-07T00:00:00.000Z')
    expect(publicContentWhere(ContentType.POST,{tag:'launch',featured:'false'},now)).toEqual({
      type:ContentType.POST,
      status:'PUBLISHED',
      publishedAt:{lte:now},
      tags:{has:'launch'},
      isFeatured:false
    })
  })
  it('uses a requested visible country instead of falling back to the default',()=>{
    const visible=new Set(['MY','SG'])
    expect(publicListingCountry('sg',visible,'MY')).toBe('SG')
    expect(publicListingCountry('all',visible,'MY')).toBe('all')
    expect(publicListingCountry('ID',visible,'MY')).toBe('MY')
  })
  it('returns Simplified Chinese by default and a linked English variant on request',()=>{
    const item={id:'story',title:'中文标题',excerpt:'中文摘要',markdown:'中文内容',html:'<p>中文内容</p>',wordCount:4,translations:[{language:'EN',title:'English title',excerpt:'English excerpt',markdown:'English body',html:'<p>English body</p>',wordCount:2}]}
    expect(localizeContent(item,undefined)).toMatchObject({title:'中文标题',language:'zh-CN',availableLanguages:['zh-CN','en']})
    expect(localizeContent(item,'en')).toMatchObject({title:'English title',language:'en',availableLanguages:['zh-CN','en']})
  })
})
