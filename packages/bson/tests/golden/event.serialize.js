// externals: String_0, fn_0, typedArrayToBase64_0, fn_1
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=v0.title;
if(v2.loosely!==false&&("number"===typeof v0.title||"boolean"===typeof v0.title||"bigint"===typeof v0.title)){
    v3=String_0(v0.title);
}
var v4={id:v0.id,at:(v0.at==null?v0.at:fn_0(v0.at)),big:String_0(v0.big),bytes:typedArrayToBase64_0(v0.bytes),title:v3};
if(("until" in v0)){
    if(null!=v0.until){
        v4.until=(v0.until==null?v0.until:fn_1(v0.until));
    }else{
        v4.until=null;
    }
}
return v4;
}
