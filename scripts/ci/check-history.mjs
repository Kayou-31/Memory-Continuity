import {execFileSync} from 'node:child_process'
const revisions=['fdd9209f26185e346a862d422005cecd4770117a','ee6b5a1898f128a0baf953ea192ba80795ac674d','1d997516a3cb0621163a94a2bb16b1a7bd28243c']
for(const revision of revisions){
 try{execFileSync('git',['cat-file','-e',revision+':src/rp/store.ts'],{stdio:'pipe'})}
 catch{throw Error('历史读取器所需源码缺失：'+revision+'；请使用完整 Git 历史（checkout fetch-depth: 0），不能跳过旧版读取测试。')}
}
console.log('历史读取器的三个固定源码版本均可读取。')
