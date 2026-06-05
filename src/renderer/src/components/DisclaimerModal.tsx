import { useState } from 'react'

interface Props {
  onAccept: () => void
  onClose?: () => void // 再表示時に閉じられる（初回は未指定でブロック）
}

export function DisclaimerModal({ onAccept, onClose }: Props): React.JSX.Element {
  const [checked, setChecked] = useState(false)
  const reshow = Boolean(onClose)

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="disc-title">
        <h2 id="disc-title">ご利用にあたっての注意</h2>
        <div className="modal-body">
          <p>本アプリは技術的なダウンロード手段を提供するのみです。ご利用の際は以下にご同意ください。</p>
          <ul>
            <li>各サイトの利用規約および著作権法を遵守する責任は利用者にあります。</li>
            <li>
              自分が権利を持つコンテンツ・許諾済みコンテンツ・パブリックドメイン等、合法的な用途を想定しています。
            </li>
            <li>
              日本の著作権法では、違法アップロードされた著作物を違法と知りながらダウンロードする行為は、私的使用目的でも規制対象となりうります。
            </li>
          </ul>
        </div>
        {!reshow && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            上記に同意します
          </label>
        )}
        <div className="modal-actions">
          {reshow ? (
            <button onClick={onClose}>閉じる</button>
          ) : (
            <button className="primary" disabled={!checked} onClick={onAccept}>
              同意して始める
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
