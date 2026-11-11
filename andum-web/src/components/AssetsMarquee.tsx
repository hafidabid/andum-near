import { ASSET_IDS, AS, AssetIcon, assetLabel } from '@/lib/assets'
import { Rv } from './Rv'

export function AssetsMarquee() {
  const items = [...ASSET_IDS, ...ASSET_IDS]
  return (
    <Rv className="assets">
      <div className="mono cap2" aria-hidden="true">In one package: currencies, gold and stocks</div>
      <div className="marq" role="list" aria-label="Assets you can put in a package">
        {items.map((a, i) => (
          <div role="listitem" className="atk" key={`${a}-${i}`} aria-hidden={i >= ASSET_IDS.length || undefined}>
            <AssetIcon a={a} size={34} />
            <div>
              <b>{assetLabel(a)}</b>
              <span className="nm">{AS[a].n}</span>
            </div>
          </div>
        ))}
      </div>
    </Rv>
  )
}
