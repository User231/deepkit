// externals: (none)
'use strict';
function _nfn_0(n,by=1){
return (n*by);
}
function _nfn_1(n){
return ("#"+_nfn_0(n,10));
}
return function(list,factor=2){
return list.map(v2=>[_nfn_0(v2,factor),_nfn_1(v2)]);
}

// externals: (none)
'use strict';
function _fn_0(v0){return "object"===typeof v0&&null!==v0;}return function(value){
return _fn_0(value);
}
